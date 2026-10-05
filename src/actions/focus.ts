import streamDeck from "@elgato/streamdeck";
import type { HerdrClient } from "../herdr/client";
import type { TerminalActivator } from "../os/terminal";

// Focus an agent's pane in herdr, then raise the host terminal so the pane is
// actually on screen even when the terminal was in the background. The two
// steps are independent so a raise failure never masks a successful pane
// switch. Returns false when the herdr focus itself failed.
export async function focusAgent(
  herdr: HerdrClient,
  terminal: TerminalActivator,
  target: string,
): Promise<boolean> {
  let ok = true;
  try {
    await herdr.focus(target);
  } catch (e) {
    ok = false;
    streamDeck.logger.error(`focus ${target} failed: ${String(e)}`);
  }
  try {
    await terminal.activate();
  } catch (e) {
    streamDeck.logger.error(`raise terminal failed: ${String(e)}`);
  }
  return ok;
}
