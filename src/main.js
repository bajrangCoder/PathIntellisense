import plugin from "../plugin.json";
import LRUCache from "./cache.js";

const fsOperation = acode.require("fsOperation");
const helpers = acode.require("helpers");

const { editor } = editorManager;

class PathIntellisense {
    constructor() {
        this.directoryCache = new LRUCache();
    }

    async init() {
        const self = this;
        editor.completers.push({
            getCompletions: async function (
                editor,
                session,
                pos,
                prefix,
                callback
            ) {
                const currentLine = session.getLine(pos.row);
                let input = self.getCurrentInput(currentLine, pos.column);
                if (!editorManager.activeFile.uri) return;
                let currentDirectory = self.removeFileNameAndExtension(
                    editorManager.activeFile.uri
                );
                if (input.startsWith("/")) {
                    const basePath = currentDirectory;
                    const fullPath = self.resolveRelativePath(basePath, input);
                    await self.fetchDirectoryContents(
                        fullPath,
                        callback,
                        false
                    );
                } else if (input.startsWith("../")) {
                    const basePath = currentDirectory;
                    const fullPath = self.resolveRelativePath(basePath, input);
                    await self.fetchDirectoryContents(
                        fullPath,
                        callback,
                        false
                    );
                } else if (input.startsWith("./")) {
                    const basePath = currentDirectory;
                    const fullPath = self.resolveRelativePath(
                        basePath,
                        input.substring(1)
                    ); // Remove the dot
                    await self.fetchDirectoryContents(
                        fullPath,
                        callback,
                        false
                    );
                } else {
                    await self.fetchDirectoryContents(
                        currentDirectory,
                        callback,
                        true
                    );
                }
            }
        });
        editor.commands.on("afterExec", function (e) {
            if (e.command.name === "insertstring" && e.args === "/") {
                editor.execCommand("startAutocomplete");
            }
        });
    }

    async fetchDirectoryContents(path, callback, isNormal) {
        try {
            const cachedData = await this.directoryCache.getAsync(path);

            if (cachedData) {
                callback(null, cachedData);
                return;
            }

            const list = await fsOperation(path).lsDir();
            const suggestions = list.map(function (item) {
                return {
                    caption: item.name,
                    value: item.name,
                    score: isNormal ? 500 : 8000,
                    meta: item.isFile ? "File" : "Folder",
                    icon: item.isFile
                        ? `${helpers.getIconForFile(item.name)}`
                        : "icon folder"
                };
            });
            // Cache the directory contents for future use
            await this.directoryCache.setAsync(path, suggestions);

            // Call the callback function with the suggestions
            callback(null, suggestions);
        } catch (err) {
            callback(null, []);
            console.log(err);
        }
    }

    getCurrentInput(line, column) {
        let input = "";
        let i = column - 1;
        while (i >= 0 && /[a-zA-Z0-9/.+_\-\s]/.test(line[i])) {
            input = line[i] + input;
            i--;
        }
        return input;
    }

    resolveRelativePath(basePath, relativePath) {
        if (relativePath.startsWith("/")) {
            // Absolute path, return it as is
            return basePath + relativePath;
        }

        const basePathParts = basePath.split("::");
        if (basePathParts.length === 2) {
            const baseUri = basePathParts[0];
            const baseDir = basePathParts[1];
            const relativeParts = relativePath.split("/");

            let newDir = baseDir.split("/").filter(Boolean);

            // Set a limit for the base directory path
            const limitPath = "data/data/com.termux/files/home";

            for (const part of relativeParts) {
                if (part === "..") {
                    // Move up one directory, but avoid going above the root and limitPath
                    if (newDir.length > 1 && newDir.join("/") !== limitPath) {
                        newDir.pop();
                    }
                } else if (
                    part !== "." &&
                    part !== "" &&
                    newDir.join("/") !== limitPath
                ) {
                    // Ignore '.' (current directory) and empty parts
                    newDir.push(part);
                } else if (
                    part !== "." &&
                    part !== "" &&
                    part !== ".." &&
                    newDir.join("/") === limitPath
                ) {
                    // If in the limitPath and encountering a directory, move into that directory
                    newDir.push(part);
                }
            }

            const newDirPath = newDir.join("/");
            const resolvedPath =
                newDirPath !== limitPath
                    ? baseUri + "::/" + newDirPath
                    : baseUri + "::/" + newDirPath;
            return resolvedPath + "/";
        }

        // Return the basePath unmodified if it doesn't match the expected format
        return basePath;
    }

    removeFileNameAndExtension(filePath) {
        const lastSlashIndex = filePath.lastIndexOf("/");
        const fileName = filePath.substring(lastSlashIndex + 1);
        return filePath.substring(0, filePath.length - fileName.length - 1);
    }

    async destroy() {}
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
            await acodePlugin.init($page, cacheFile, cacheFileUrl);
        }
    );
    acode.setPluginUnmount(plugin.id, () => {
        acodePlugin.destroy();
    });
}
