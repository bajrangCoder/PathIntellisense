import type {
	Completion,
	CompletionContext,
	CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
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

type CodeMirrorView = Acode.EditorLike & {
	contentDOM?: HTMLElement;
	execCommand?: (name: string) => boolean;
	setState?: (state: unknown) => void;
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
	private codeMirrorInputHandler: ((event: Event) => void) | null = null;
	private codeMirrorSwitchHandler: (() => void) | null = null;
	private installedViews = new WeakSet<object>();
	private codeMirrorAutocompleteExtension: Extension | null = null;

	async init(): Promise<void> {
		const editor = editorManager.editor;
		if (!editor) return;

		this.registerResetCommand(editor);

		if (editorManager.isCodeMirror === true) {
			this.initCodeMirror(editor as CodeMirrorView);
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
		this.installCodeMirrorCompletionSource();
		this.codeMirrorSwitchHandler = () => {
			this.installCodeMirrorCompletionSource();
		};
		editorManager.on("switch-file", this.codeMirrorSwitchHandler);

		this.codeMirrorInputHandler = (event) => {
			const data = (event as InputEvent).data;
			if (typeof data !== "string") return;
			if (data !== "/" && !data.endsWith("/")) return;
			this.triggerCodeMirrorAutocomplete();
		};
		editor.contentDOM?.addEventListener("input", this.codeMirrorInputHandler);
	}

	private getCodeMirror(): Acode.CodeMirrorNamespace | null {
		const cm = acode.require("codemirror");
		if (cm?.autocomplete && cm?.state) return cm;
		return null;
	}

	private getOrCreateAutocompleteExtension(): Extension | null {
		if (this.codeMirrorAutocompleteExtension) {
			return this.codeMirrorAutocompleteExtension;
		}

		const completionSource = this.getCodeMirrorCompletions.bind(this);
		const cm = this.getCodeMirror();
		if (cm?.state.EditorState.languageData) {
			this.codeMirrorAutocompleteExtension = cm.state.EditorState.languageData.of(
				() => [{ autocomplete: completionSource }],
			);
			return this.codeMirrorAutocompleteExtension;
		}

		const editor = editorManager.editor as CodeMirrorView | undefined;
		const EditorStateClass = editor?.state?.constructor as
			| {
					languageData?: { of: (value: unknown) => unknown };
			  }
			| undefined;
		if (!EditorStateClass?.languageData?.of) return null;

		this.codeMirrorAutocompleteExtension = EditorStateClass.languageData.of(
			() => [{ autocomplete: completionSource }],
		) as Extension;
		return this.codeMirrorAutocompleteExtension;
	}

	private appendCodeMirrorExtension(
		editor: CodeMirrorView,
		extension: Extension,
	): boolean {
		const cm = this.getCodeMirror();
		if (cm?.state.StateEffect.appendConfig) {
			editor.dispatch({
				effects: cm.state.StateEffect.appendConfig.of(extension),
			});
			return true;
		}

		const appendConfig = (
			editorManager as Acode.EditorManager & {
				readOnlyCompartment?: {
					reconfigure: (value: unknown) => {
						constructor?: { appendConfig?: { of: (value: unknown) => unknown } };
					};
				};
			}
		).readOnlyCompartment?.reconfigure([])?.constructor?.appendConfig;

		if (appendConfig?.of) {
			editor.dispatch({
				effects: appendConfig.of(extension),
			});
			return true;
		}

		const EditorStateClass = editor.state?.constructor as
			| {
					create?: (config: {
						doc: unknown;
						selection: unknown;
						extensions: unknown[];
					}) => unknown;
			  }
			| undefined;
		if (!EditorStateClass?.create || !editor.setState) return false;

		const state = editor.state as Acode.CodeMirrorEditorState & {
			config?: { base?: unknown[] };
		};
		const baseExtensions = Array.isArray(state.config?.base)
			? state.config.base.slice()
			: [];
		baseExtensions.push(extension);
		editor.setState(
			EditorStateClass.create({
				doc: state.doc,
				selection: state.selection,
				extensions: baseExtensions,
			}),
		);
		return true;
	}

	private installCodeMirrorCompletionSource(): void {
		const editor = editorManager.editor as CodeMirrorView | undefined;
		if (!editor || this.installedViews.has(editor)) return;

		const extension = this.getOrCreateAutocompleteExtension();
		if (!extension) return;

		if (this.appendCodeMirrorExtension(editor, extension)) {
			this.installedViews.add(editor);
		}
	}

	private triggerCodeMirrorAutocomplete(): void {
		const editor = editorManager.editor as CodeMirrorView | undefined;
		if (!editor) return;

		const cm = this.getCodeMirror();
		if (cm?.autocomplete.startCompletion) {
			cm.autocomplete.startCompletion(editor as never);
			return;
		}

		const commandNames = ["startAutocomplete", "startCompletion", "autocomplete"];
		for (const commandName of commandNames) {
			try {
				if (editor.execCommand?.(commandName)) return;
			} catch {
				// Keep trying fallbacks.
			}
		}

		const dispatchCtrlSpace = (metaKey: boolean) => {
			const keydown = new KeyboardEvent("keydown", {
				key: " ",
				code: "Space",
				ctrlKey: !metaKey,
				metaKey,
				bubbles: true,
				cancelable: true,
			});
			editor.contentDOM?.dispatchEvent(keydown);
			const keyup = new KeyboardEvent("keyup", {
				key: " ",
				code: "Space",
				ctrlKey: !metaKey,
				metaKey,
				bubbles: true,
				cancelable: true,
			});
			editor.contentDOM?.dispatchEvent(keyup);
		};

		dispatchCtrlSpace(false);
		dispatchCtrlSpace(true);
	}

	private async getCodeMirrorCompletions(
		context: CompletionContext,
	): Promise<CompletionResult | null> {
		const fileUri = editorManager.activeFile?.uri;
		if (!fileUri) return null;

		const word = context.matchBefore(/[a-zA-Z0-9/.+_\-$@:]*/);
		if (!word) return null;
		if (word.from === word.to && !context.explicit) return null;

		const query = this.getPathQuery(word.text);
		if (!context.explicit && !query.isPathLike) return null;

		const resolved = this.resolvePathForInput(query.lookupInput);
		if (!resolved) return null;

		const entries = await this.getDirectoryEntries(resolved.path);
		const options = this.toCodeMirrorCompletions(entries);
		if (!options.length) return null;

		return {
			from: word.to - query.segmentPrefix.length,
			options,
			validFor: /[a-zA-Z0-9.+_\-\s$@:]*$/,
		};
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
		const fileUri = editorManager.activeFile?.uri;
		if (!fileUri) return null;

		const absolutePath = "$HOME/";
		const currentDirectory = this.removeFileNameAndExtension(fileUri);

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
			const relativeInput = input.startsWith("./") ? input.substring(1) : input;
			return {
				path: this.resolveRelativePath(currentDirectory, relativeInput),
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
			type: item.isFile ? "property" : "keyword",
			detail: item.isFile ? "File" : "Folder",
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
		if (relativePath.startsWith("/")) {
			return basePath + relativePath;
		}

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
			if (this.codeMirrorInputHandler) {
				editor.contentDOM?.removeEventListener(
					"input",
					this.codeMirrorInputHandler,
				);
			}
			if (this.codeMirrorSwitchHandler) {
				editorManager.off("switch-file", this.codeMirrorSwitchHandler);
			}
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
