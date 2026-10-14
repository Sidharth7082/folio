package io.github.sidharth7082.folio;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super.onCreate, which is what builds the bridge and
        // asks every plugin to load.
        registerPlugin(FolioTtsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
