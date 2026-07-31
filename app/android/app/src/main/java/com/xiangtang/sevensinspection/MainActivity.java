package com.xiangtang.sevensinspection;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeFilePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
