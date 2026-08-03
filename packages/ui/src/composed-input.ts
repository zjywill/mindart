/**
 * An IME builds one character from several keystrokes, and the browser fires
 * an `input` event for each of them. Treating those as finished text commits
 * raw pinyin and triggers a save per keystroke, so hold the commit until the
 * composition ends and then run it once.
 */
export function bindComposedInput(
  field: HTMLInputElement | HTMLTextAreaElement,
  commit: () => void,
): void {
  let composing = false;

  field.addEventListener("compositionstart", () => {
    composing = true;
  });

  field.addEventListener("compositionend", () => {
    composing = false;
    commit();
  });

  field.addEventListener("input", (event) => {
    // `isComposing` covers browsers that report it without having dispatched a
    // compositionstart we saw, e.g. when the field is focused mid-composition.
    if (composing || (event as InputEvent).isComposing) return;
    commit();
  });
}
