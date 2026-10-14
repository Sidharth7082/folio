package io.github.sidharth7082.folio;

/*
 * Reading a book aloud, through the phone's own speech engine.
 *
 * This has to be native. The WebView has no Web Speech API — `speechSynthesis`
 * is `undefined` there, checked on the device — so there is no way to speak from
 * the page itself.
 *
 * The class is deliberately small. The queue, the highlighting and the controls
 * all live in JavaScript, where they can be changed without a build; this only
 * turns one sentence into speech and reports back what happened to it.
 *
 * `onRangeStart` is the part that matters most: it reports the character range
 * being spoken right now, which is what moves the highlight under the words as
 * they are read. It needs API 26, so older phones get the sentence highlight
 * without the word one.
 */

import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

@CapacitorPlugin(name = "FolioTts")
public class FolioTtsPlugin extends Plugin implements TextToSpeech.OnInitListener {

    private TextToSpeech engine;

    private boolean ready;
    private boolean broken;

    @Override
    public void load() {
        // Constructing it begins an asynchronous bind to the engine; onInit
        // reports how that went. On a device with no engine at all it never
        // succeeds, which is why the UI asks before it offers to read.
        engine = new TextToSpeech(getContext(), this);
    }

    @Override
    public void handleOnDestroy() {
        if (engine == null) return;
        engine.stop();
        engine.shutdown();
        engine = null;
        ready = false;
    }

    @Override
    public void onInit(int status) {
        if (status != TextToSpeech.SUCCESS || engine == null) {
            broken = true;
            return;
        }

        engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String id) {
                announce("start", id, null);
            }

            @Override
            public void onDone(String id) {
                announce("done", id, null);
            }

            @Override
            public void onError(String id) {
                announce("error", id, "the engine could not speak that");
            }

            @Override
            public void onError(String id, int code) {
                announce("error", id, "the engine could not speak that (" + code + ")");
            }

            @Override
            public void onStop(String id, boolean interrupted) {
                // Interrupting is how pausing and skipping work, so this is a
                // normal event rather than a failure.
                announce("stopped", id, null);
            }

            @Override
            public void onRangeStart(String id, int start, int end, int frame) {
                JSObject data = new JSObject();
                data.put("id", id);
                data.put("start", start);
                data.put("end", end);
                notifyListeners("range", data);
            }
        });

        ready = true;
    }

    private void announce(String event, String id, String message) {
        JSObject data = new JSObject();
        data.put("id", id == null ? "" : id);
        if (message != null) data.put("message", message);
        notifyListeners(event, data);
    }

    /**
     * Speak one piece of text.
     *
     * Resolves as soon as the engine has accepted it, not when it has finished
     * speaking: the caller learns what happened through the events. Flushing is
     * correct because the queue is kept on the JavaScript side, one sentence at
     * a time, which is also what makes the sentence highlight possible.
     */
    @PluginMethod
    public void speak(PluginCall call) {
        if (broken) {
            call.reject("no text-to-speech engine on this device", "no_engine");
            return;
        }
        if (!ready) {
            call.reject("the speech engine is still starting", "not_ready");
            return;
        }

        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.reject("nothing to say", "empty");
            return;
        }

        String id = call.getString("id", "0");
        JSObject options = call.getData();

        String tag = options.optString("lang", "");
        if (!tag.isEmpty()) {
            int status = engine.setLanguage(Locale.forLanguageTag(tag));
            if (status == TextToSpeech.LANG_MISSING_DATA || status == TextToSpeech.LANG_NOT_SUPPORTED) {
                call.reject("that language is not installed", "no_language");
                return;
            }
        }

        engine.setSpeechRate((float) options.optDouble("rate", 1));
        engine.setPitch((float) options.optDouble("pitch", 1));

        if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.ERROR) {
            call.reject("the engine refused to speak that", "refused");
            return;
        }

        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (engine != null) engine.stop();
        call.resolve();
    }

    /** Asked before the reader offers to read anything out loud. */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", ready && !broken);
        result.put("broken", broken);
        result.put("speaking", engine != null && engine.isSpeaking());
        if (broken) result.put("reason", "no text-to-speech engine on this device");
        call.resolve(result);
    }
}
