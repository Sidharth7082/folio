package io.github.sidharth7082.folio;

/*
 * Putting a block of text on the clipboard.
 *
 * The WebView will not do it, and this was checked on a device rather than
 * assumed: `navigator.clipboard.writeText` is refused without a native
 * permission hook, and `document.execCommand("copy")` answers false. That left
 * the backup with no way out of the phone except selecting the text and
 * long-pressing it, which is a silly thing to ask of somebody who has just
 * tapped a button called Copy.
 *
 * The system shows its own confirmation on Android 13 and up, so there is
 * nothing for this to do beyond handing the text over.
 */

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FolioClipboard")
public class FolioClipboardPlugin extends Plugin {

    @PluginMethod
    public void copy(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.isEmpty()) {
            call.reject("there is nothing to copy", "empty");
            return;
        }

        ClipboardManager clipboard =
            (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) {
            call.reject("this device has no clipboard", "no_clipboard");
            return;
        }

        clipboard.setPrimaryClip(ClipData.newPlainText("Folio backup", text));
        call.resolve();
    }

    /** The other direction, so a backup can be pasted in rather than typed. */
    @PluginMethod
    public void read(PluginCall call) {
        ClipboardManager clipboard =
            (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);

        String text = "";
        if (clipboard != null && clipboard.hasPrimaryClip()) {
            ClipData clip = clipboard.getPrimaryClip();
            if (clip != null && clip.getItemCount() > 0) {
                CharSequence held = clip.getItemAt(0).coerceToText(getContext());
                if (held != null) text = held.toString();
            }
        }

        JSObject result = new JSObject();
        result.put("text", text);
        call.resolve(result);
    }
}
