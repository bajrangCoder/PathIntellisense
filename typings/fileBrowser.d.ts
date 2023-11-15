/**
 * The type of the selected item, either 'file' or 'folder'.
 */
type ItemType = 'file' | 'folder';

/**
 * An object that contains information about the selected file or folder.
 */
interface SelectedFile {
  type: ItemType;
  url: string;
  name: string;
}

/**
 * The mode for the file browser, which can be 'file', 'folder', or 'both'.
 */
type BrowseMode = 'file' | 'folder' | 'both';

/**
 * Opens the file browser and allows the user to select a file or folder.
 *
 * @param mode - Specify the file browser mode, the value can be 'file', 'folder', or 'both'.
 * @param info - A small message to show what the file browser is opened for.
 * @param doesOpenLast - Should the file browser open the last visited directory.
 * @param defaultDir - Default directory to open.
 * @returns A promise that resolves to an object with the selected file or folder details.
 */
declare function openFileBrowser(
  mode?: BrowseMode,
  info?: string,
  doesOpenLast?: boolean,
  defaultDir?: { name: string; url: string }[]
): Promise<SelectedFile>;

type FileBrowser = typeof openFileBrowser;
