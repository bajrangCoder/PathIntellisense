# ChangeLogs

## 1.2.0

- Migrated the plugin to the latest Acode TypeScript template
- Replaced local typings with `acode-plugin-types`
- Switched to the official esbuild + `plugin.zip` development workflow
- Use the current Acode filesystem, command, and CodeMirror APIs
- Fixed CodeMirror path completions by registering the official autocomplete extension and completion source
- Keep completions working across file switches and split panes, and reopen them after selecting a folder
- Respect CodeMirror syntax trees and suppress path completions inside comments
- Continue CodeMirror completion and filtering through deeply nested folders
- Resolve `../` and `../../` with Acode's URI-aware path utilities
- Keep the full completion filter range synchronized during Android IME composition

## 1.1.2

- Existing stable release with Ace and CodeMirror path completions
