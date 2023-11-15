/**
 * Loader dialog box
 */

/**
 * Options for the loader dialog.
 */
interface LoaderOptions {
  timeout: number;
  oncancel: () => void;
}

/**
 * a loader dialog instance.
 */
interface Loader {
  setTitle(title: string): void;
  setMessage(message: string): void;
  hide(): void;
  destroy(): void;
  show(): void;
}

/**
 * methods of acode loader dialog api
 */
interface LoaderDialog {
  /**
   * Creates a new loader dialog.
   *
   * @param titleText - The title text to display.
   * @param message - The message to display (optional).
   * @param options - Options for the loader dialog (optional).
   * @returns A loader instance.
   */
  create(titleText: string, message?: string, options?: LoaderOptions): Loader;

  /**
   * Destroys the loader dialog.
   */
  destroy(): void;

  /**
   * Shows the loader dialog.
   */
  show(): void;

  /**
   * Hides the loader dialog.
   */
  hide(): void;

  /**
   * Shows the title loader.
   *
   * @param immortal - Indicates whether the title loader is permanent (optional).
   */
  showTitleLoader(immortal?: boolean): void;

  /**
   * Removes the title loader.
   *
   * @param immortal - Indicates whether the title loader is permanent (optional).
   */
  removeTitleLoader(immortal?: boolean): void;
}

/**
 * prompt dialog box
 */

/**
 * Options for the prompt dialog.
 */
interface PromptOptions {
  match?: RegExp;
  required?: boolean;
  placeholder?: string;
  test?: (value: any) => boolean;
}

/**
 * Represents the type of input for the prompt dialog.
 */
type PromptInputType =
  | "textarea"
  | "text"
  | "number"
  | "tel"
  | "search"
  | "email"
  | "url";

/**
 * Opens a prompt dialog.
 *
 * @param message - The message to display to the user.
 * @param defaultValue - The default value of the input.
 * @param type - The type of input (e.g., "textarea", "text", "number").
 * @param options - Additional options for the prompt dialog (optional).
 * @returns A promise that resolves to the user's input value (string, number, or null if canceled).
 */
declare function prompt(
  message: string,
  defaultValue: string,
  type?: PromptInputType,
  options?: PromptOptions
): Promise<string | number | null>;

type PromptDialog = typeof prompt;


/**
 * Opens an alert dialog.
 *
 * @param titleText - The title text of the alert.
 * @param message - The message to display in the alert.
 * @param onhide - A callback function to be called when the alert is closed (optional).
 */
declare function showAlert(titleText: string, message: string, onhide?: () => void): void;
type AlertDialog = typeof showAlert;