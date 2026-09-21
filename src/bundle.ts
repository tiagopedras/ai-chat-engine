/* The one-file build's entry: hangs `AIChat` on window, the same one name a
   page has always loaded this by, so a host that drops in a <script> and calls
   AIChat.create() keeps working. Nothing else is exported to the page. */
import { create } from './create';

declare global {
  interface Window { AIChat: { create: typeof create } }
}
window.AIChat = { create };
