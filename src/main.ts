import type {
	Completion,
	CompletionContext,
	CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type * as LezerHighlight from "@lezer/highlight";
import plugin from "../plugin.json";
import LRUCache from "./cache";

type DirectoryEntry = {
	name: string;
	isFile: boolean;
};

type PathQuery = {
	isPathLike: boolean;
	lookupInput: string;
	segmentPrefix: string;
};

type ResolvedPath = {
	path: string;
	isNormal: boolean;
};

type AceCompletion = {
	caption: string;
	value: string;
	score: number;
	meta: string;
	icon?: string;
};

type AceCompleter = {
	getCompletions: (
		editor: unknown,
		session: { getLine(row: number): string },
		pos: { row: number; column: number },
		prefix: string,
		callback: (error: unknown, completions: AceCompletion[]) => void,
	) => void | Promise<void>;
};

type AceEditor = Ace.Editor & {
	completers: AceCompleter[];
	commands: Acode.Commands & {
		on(event: string, handler: (...args: unknown[]) => void): void;
		off(event: string, handler: (...args: unknown[]) => void): void;
	};
};

type CodeMirrorView = Acode.EditorLike & EditorView;

type CodeMirrorModules = {
	autocomplete: Acode.CodeMirrorNamespace["autocomplete"];
	language: Acode.CodeMirrorNamespace["language"];
	state: Acode.CodeMirrorNamespace["state"];
	view: Acode.CodeMirrorNamespace["view"];
	lezerHighlight: typeof LezerHighlight;
};

type CodeMirrorCompartment = {
	of(extension: Extension): Extension;
	reconfigure(extension: Extension): unknown;
	get(state: EditorState): Extension | undefined;
};

type AceAfterExecEvent = {
	command?: { name?: string };
	args?: string;
};

declare const extraSyntaxHighlightsInstalled: boolean | undefined;

class PathIntellisense {
	baseUrl = "";
	private directoryCache = new LRUCache<DirectoryEntry[]>();
	private pathAutoCompletions: AceCompleter | null = null;
	private aceAfterExecHandler: ((event: AceAfterExecEvent) => void) | null =
		null;
	private codeMirrorSwitchHandler: (() => void) | null = null;
	private codeMirrorViews = new Set<CodeMirrorView>();
	private codeMirrorCompartment: CodeMirrorCompartment | null = null;
	private codeMirrorAutocompleteExtension: Extension | null = null;
	private codeMirrorEnabled = false;

	async init(): Promise<void> {
		const editor = editorManager.editor;
		if (!editor) return;

		this.registerResetCommand(editor);

		if (editorManager.isCodeMirror === true) {
			this.initCodeMirror(editor as unknown as CodeMirrorView);
			return;
		}

		this.initAce(editor as AceEditor);
	}

	private registerResetCommand(editor: Ace.Editor & Acode.EditorLike): void {
		const command = {
			name: "pathintellisense:reset_cache",
			description: "Reset PathIntellisense Cache",
			exec: () => {
				this.clearCache();
				return true;
			},
		};

		if (typeof acode.addCommand === "function") {
			acode.addCommand(command);
			return;
		}

		editor.commands.addCommand(command);
	}

	private initAce(editor: AceEditor): void {
		this.pathAutoCompletions = {
			getCompletions: async (_editor, session, pos, _prefix, callback) => {
				try {
					const currentLine = session.getLine(pos.row);
					if (this.isInAceComment(session, pos)) {
						callback(null, []);
						return;
					}
					const input = this.getCurrentInput(currentLine, pos.column);
					const query = this.getPathQuery(input);
					const resolved = this.resolvePathForInput(query.lookupInput);
					if (!resolved) {
						callback(null, []);
						return;
					}

					const entries = await this.getDirectoryEntries(resolved.path);
					callback(null, this.toAceCompletions(entries, resolved.isNormal));
				} catch (error) {
					callback(null, []);
					console.log(error instanceof Error ? error.message : error);
				}
			},
		};

		editor.completers.unshift(this.pathAutoCompletions);

		this.aceAfterExecHandler = (event) => {
			if (
				event.command?.name === "insertstring" &&
				typeof event.args === "string" &&
				(event.args === "/" || event.args.endsWith("/"))
			) {
				editor.execCommand("startAutocomplete");
			}
		};
		editor.commands.on("afterExec", this.aceAfterExecHandler);
	}

	private initCodeMirror(editor: CodeMirrorView): void {
		this.codeMirrorEnabled = true;
		const existingViews = new Set<CodeMirrorView>([editor]);
		for (const pane of editorManager.panes ?? []) {
			if (pane.editor) {
				existingViews.add(pane.editor as unknown as CodeMirrorView);
			}
		}
		for (const view of existingViews) {
			this.installCodeMirrorCompletionSource(view);
		}

		this.codeMirrorSwitchHandler = () => {
			queueMicrotask(() => {
				if (!this.codeMirrorEnabled) return;
				const activeEditor = editorManager.editor as unknown as
					| CodeMirrorView
					| undefined;
				if (activeEditor) this.installCodeMirrorCompletionSource(activeEditor);
			});
		};
		editorManager.on("switch-file", this.codeMirrorSwitchHandler);
	}

	private getCodeMirror(): CodeMirrorModules | null {
		const bundled = acode.require("codemirror");
		const autocomplete =
			bundled?.autocomplete ?? acode.require("@codemirror/autocomplete");
		const language =
			bundled?.language ?? acode.require("@codemirror/language");
		const state = bundled?.state ?? acode.require("@codemirror/state");
		const view = bundled?.view ?? acode.require("@codemirror/view");
		const lezerHighlight =
			bundled?.lezer?.highlight ??
			bundled?.lezer ??
			acode.require("@lezer/highlight");

		if (
			!autocomplete?.autocompletion ||
			!language?.syntaxTree ||
			!state?.StateEffect ||
			!view?.EditorView ||
			!lezerHighlight?.getStyleTags
		) {
			return null;
		}

		return { autocomplete, language, state, view, lezerHighlight };
	}

	private getOrCreateAutocompleteExtension(): Extension | null {
		if (this.codeMirrorAutocompleteExtension) {
			return this.codeMirrorAutocompleteExtension;
		}

		const cm = this.getCodeMirror();
		if (!cm?.state.EditorState.languageData) return null;

		const completionSource = this.getCodeMirrorCompletions.bind(this);
		const pathCompletionData = cm.state.EditorState.languageData.of(() => [
			{ autocomplete: completionSource },
		]);
		const restartAfterTypedSlash = cm.view.EditorView.updateListener.of(
			(update) => {
				if (!update.docChanged) return;

				// Folder picks are continued by activateOnCompletion below. Starting
				// here too would create overlapping completion sessions.
				const pickedCompletion = update.transactions.some((transaction) =>
					transaction.annotation(cm.autocomplete.pickedCompletion),
				);
				if (pickedCompletion) return;

				const cursor = update.state.selection.main.head;
				if (
					cursor === 0 ||
					update.state.sliceDoc(cursor - 1, cursor) !== "/" ||
					this.isInCodeMirrorComment(update.state, cursor, cm)
				) {
					return;
				}

				queueMicrotask(() => {
					if (this.codeMirrorEnabled) {
						cm.autocomplete.startCompletion(update.view);
					}
				});
			},
		);

		// `autocompletion()` installs the state field, tooltip, and official keymap.
		// Language data adds this source without replacing completions from the
		// active language package. `activateOnCompletion` is CodeMirror's native
		// mechanism for continuing from one completed path segment to the next.
		this.codeMirrorAutocompleteExtension = [
			cm.autocomplete.autocompletion({
				activateOnCompletion: (completion) =>
					completion.type === "namespace" && completion.detail === "Folder",
			}),
			pathCompletionData,
			restartAfterTypedSlash,
		];
		return this.codeMirrorAutocompleteExtension;
	}

	private getOrCreateCodeMirrorCompartment(): CodeMirrorCompartment | null {
		if (this.codeMirrorCompartment) return this.codeMirrorCompartment;

		const cm = this.getCodeMirror();
		if (!cm?.state.Compartment) return null;

		this.codeMirrorCompartment = new cm.state.Compartment();
		return this.codeMirrorCompartment;
	}

	private installCodeMirrorCompletionSource(editor: CodeMirrorView): void {
		if (!this.codeMirrorEnabled) return;

		const extension = this.getOrCreateAutocompleteExtension();
		const compartment = this.getOrCreateCodeMirrorCompartment();
		const cm = this.getCodeMirror();
		if (!extension || !compartment || !cm) return;

		// Acode may replace the state while keeping the same EditorView. Checking
		// the compartment in the current state is therefore safer than remembering
		// the view or file ID.
		if (compartment.get(editor.state) !== undefined) {
			this.codeMirrorViews.add(editor);
			return;
		}

		editor.dispatch({
			effects: cm.state.StateEffect.appendConfig.of(
				compartment.of(extension),
			),
		});
		this.codeMirrorViews.add(editor);
	}

	private async getCodeMirrorCompletions(
		context: CompletionContext,
	): Promise<CompletionResult | null> {
		const fileUri = editorManager.activeFile?.uri;
		if (!fileUri) return null;

		const cm = this.getCodeMirror();
		if (!cm || this.isInCodeMirrorComment(context.state, context.pos, cm)) {
			return null;
		}

		const word = context.matchBefore(/[a-zA-Z0-9/.+_\-$@:%]*/);
		if (!word) return null;
		if (word.from === word.to && !context.explicit) return null;

		const query = this.getPathQuery(word.text);
		if (!context.explicit && !query.isPathLike) return null;

		const resolved = this.resolvePathForInput(query.lookupInput);
		if (!resolved) return null;

		const entries = await this.getDirectoryEntries(resolved.path);
		if (context.aborted) return null;

		const options = this.toCodeMirrorCompletions(entries);
		if (!options.length) return null;

		return {
			from: word.to - query.segmentPrefix.length,
			to: context.pos,
			options,
			// Android IMEs may update an in-progress word through composition
			// transactions. Explicitly move `to` to the live cursor so CodeMirror
			// scores against the whole segment ("breadcr"), not its first committed
			// character ("b"). Reuse the directory listing while the cursor stays
			// within the same path segment.
			update: (current, from, _to, nextContext) => {
				if (nextContext.pos < from) return null;
				const segment = nextContext.state.sliceDoc(from, nextContext.pos);
				if (!/^[a-zA-Z0-9.+_\-\s$@:%]*$/.test(segment)) return null;

				return {
					...current,
					from,
					to: nextContext.pos,
				};
			},
		};
	}

	private isInCodeMirrorComment(
		state: EditorState,
		pos: number,
		cm: CodeMirrorModules,
	): boolean {
		let node: SyntaxNode | null = cm.language
			.syntaxTree(state)
			.resolveInner(pos, -1);
		const commentTag = cm.lezerHighlight.tags.comment;

		for (; node; node = node.parent) {
			const style = cm.lezerHighlight.getStyleTags(node);
			if (style?.tags.some((tag) => tag.set.includes(commentTag))) {
				return true;
			}
		}

		return false;
	}

	private isInAceComment(
		session: { getLine(row: number): string },
		pos: { column: number },
	): boolean {
		const line = session.getLine(pos.row);
		const before = line.substring(0, pos.column);
		const trimmed = before.trimStart();
		if (
			trimmed.startsWith('//') ||
			trimmed.startsWith('#') ||
			trimmed.startsWith('--') ||
			trimmed.startsWith("'")
		) {
			return true;
		}
		const open = before.lastIndexOf('/*');
		const close = before.lastIndexOf('*/');
		return open !== -1 && (close === -1 || open > close);
	}

	private getPathQuery(input: string): PathQuery {
		const isPathLike =
			input.startsWith("$HOME/") ||
			input.startsWith("/") ||
			input.startsWith("./") ||
			input.startsWith("../") ||
			input.includes("/");

		if (!isPathLike) {
			return {
				isPathLike: false,
				lookupInput: input,
				segmentPrefix: input,
			};
		}

		const lastSlashIndex = input.lastIndexOf("/");
		const lookupInput =
			lastSlashIndex === -1 ? input : input.substring(0, lastSlashIndex + 1);
		const segmentPrefix =
			lastSlashIndex === -1 ? input : input.substring(lastSlashIndex + 1);

		return {
			isPathLike: true,
			lookupInput,
			segmentPrefix,
		};
	}

	private clearCache(): void {
		this.directoryCache.resetCache();
		const toast = acode.require("toast");
		if (typeof toast === "function") {
			toast("Cache Cleared 🔥", 2000);
		}
	}

	private resolvePathForInput(input: string): ResolvedPath | null {
		const activeFile = editorManager.activeFile;
		const fileUri = activeFile?.uri;
		if (!fileUri) return null;

		const absolutePath = "$HOME/";
		const url = acode.require("url");
		const currentDirectory =
			activeFile.location ??
			url?.dirname?.(fileUri) ??
			this.removeFileNameAndExtension(fileUri);
		if (!currentDirectory) return null;

		if (input.startsWith(absolutePath)) {
			const folderPath = input.substring(absolutePath.length);
			return {
				path:
					"content://com.termux.documents/tree/%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome::/data/data/com.termux/files/home/" +
					folderPath,
				isNormal: false,
			};
		}

		if (
			input.startsWith("/") ||
			input.startsWith("../") ||
			input.startsWith("./") ||
			input.includes("/")
		) {
			return {
				path: this.resolveRelativePath(currentDirectory, input),
				isNormal: false,
			};
		}

		return {
			path: currentDirectory,
			isNormal: true,
		};
	}

	private async getDirectoryEntries(path: string): Promise<DirectoryEntry[]> {
		try {
			const cachedData = await this.directoryCache.getAsync(path);
			if (cachedData) return cachedData;

			const fs = acode.require("fs") ?? acode.require("fsOperation");
			const list = await fs(path).lsDir();
			const entries = list.map((item) => ({
				name: item.name,
				isFile: item.isFile,
			}));
			await this.directoryCache.setAsync(path, entries);
			return entries;
		} catch (err) {
			console.log(
				err instanceof Error
					? err.message
					: err?.toString?.() || "PathIntellisense: lsDir failed",
			);
			return [];
		}
	}

	private toAceCompletions(
		entries: DirectoryEntry[],
		isNormal: boolean,
	): AceCompletion[] {
		const helpers = acode.require("helpers");
		return entries.map((item) => {
			const completion: AceCompletion = {
				caption: item.name,
				value: item.name,
				score: isNormal ? 500 : 8000,
				meta: item.isFile ? "File" : "Folder",
			};

			if (
				typeof extraSyntaxHighlightsInstalled !== "undefined" &&
				extraSyntaxHighlightsInstalled
			) {
				completion.icon = item.isFile
					? helpers.getIconForFile(item.name)
					: "icon folder";
			}

			if (!item.isFile) {
				completion.value += "/";
			}

			return completion;
		});
	}

	private toCodeMirrorCompletions(entries: DirectoryEntry[]): Completion[] {
		return entries.map((item) => ({
			label: item.isFile ? item.name : `${item.name}/`,
			type: item.isFile ? "text" : "namespace",
			detail: item.isFile ? "File" : "Folder",
			boost: item.isFile ? 0 : 10,
		}));
	}

	private getCurrentInput(line: string, column: number): string {
		let input = "";
		let i = column - 1;
		while (i >= 0 && /[a-zA-Z0-9/.+_\-\s$@:]/.test(line[i])) {
			input = line[i] + input;
			i--;
		}
		return input;
	}

	private resolveRelativePath(basePath: string, relativePath: string): string {
		const url = acode.require("url");
		if (url?.join) {
			// A leading slash is how this plugin historically represents a path
			// relative to the current file. Acode's Url.join handles `.` and `..`
			// while preserving SAF/content URI roots and remote protocols.
			const pathFromCurrentDirectory = relativePath.replace(/^\/+/, "");
			const resolved = url.join(basePath, pathFromCurrentDirectory || ".");
			if (resolved) return resolved;
		}

		// Compatibility fallback for older Acode builds without Url.join.
		if (relativePath.startsWith("/")) return basePath + relativePath;

		const basePathParts = basePath.split("::");
		if (basePathParts.length !== 2) return basePath;

		const baseUri = basePathParts[0];
		let baseDir = basePathParts[1];
		if (!baseDir.endsWith("/")) {
			baseDir += "/";
		}

		for (const part of relativePath.split("/")) {
			if (part === "..") {
				const lastSlashIndex = baseDir.lastIndexOf("/", baseDir.length - 2);
				if (lastSlashIndex !== -1) {
					baseDir = baseDir.substring(0, lastSlashIndex + 1);
				}
			} else if (part !== "." && part !== "") {
				baseDir += `${part}/`;
			}
		}

		return `${baseUri}::${baseDir}`;
	}

	private removeFileNameAndExtension(filePath: string): string {
		const lastSlashIndex = filePath.lastIndexOf("/");
		const fileName = filePath.substring(lastSlashIndex + 1);
		return filePath.substring(0, filePath.length - fileName.length - 1);
	}

	async destroy(): Promise<void> {
		const editor = editorManager.editor as
			| (AceEditor & CodeMirrorView)
			| undefined;
		if (!editor) return;

		if (typeof acode.removeCommand === "function") {
			acode.removeCommand("pathintellisense:reset_cache");
		} else {
			editor.commands.removeCommand("pathintellisense:reset_cache");
		}

		if (editorManager.isCodeMirror === true) {
			this.codeMirrorEnabled = false;
			if (this.codeMirrorSwitchHandler) {
				editorManager.off("switch-file", this.codeMirrorSwitchHandler);
			}

			const compartment = this.codeMirrorCompartment;
			if (compartment) {
				for (const view of this.codeMirrorViews) {
					try {
						if (compartment.get(view.state) === undefined) continue;
						view.dispatch({ effects: compartment.reconfigure([]) });
					} catch {
						// Closed panes may hold a destroyed EditorView.
					}
				}
			}
			this.codeMirrorViews.clear();
			return;
		}

		if (this.pathAutoCompletions) {
			const index = editor.completers.indexOf(this.pathAutoCompletions);
			if (index !== -1) {
				editor.completers.splice(index, 1);
			}
		}

		if (this.aceAfterExecHandler) {
			editor.commands.off("afterExec", this.aceAfterExecHandler);
		}
	}
}

if (window.acode) {
	const acodePlugin = new PathIntellisense();
	acode.setPluginInit(
		plugin.id,
		async (baseUrl, $page, { cacheFileUrl, cacheFile }) => {
			if (!baseUrl.endsWith("/")) {
				baseUrl += "/";
			}
			acodePlugin.baseUrl = baseUrl;
			await acodePlugin.init();
		},
	);
	acode.setPluginUnmount(plugin.id, () => {
		void acodePlugin.destroy();
	});
}
