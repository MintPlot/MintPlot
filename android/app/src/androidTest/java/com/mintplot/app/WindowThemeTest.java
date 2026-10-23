package com.mintplot.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.res.TypedArray;
import android.os.ParcelFileDescriptor;
import android.view.ContextThemeWrapper;
import android.view.Window;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleCallback;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;

import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.Test;
import org.junit.runner.RunWith;

/** Native resource and window checks for title-free launch and recreation. */
@RunWith(AndroidJUnit4.class)
public class WindowThemeTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    private void assertNoPlatformTitle(int theme) {
        TypedArray attributes = new ContextThemeWrapper(context, theme).obtainStyledAttributes(
            new int[] { android.R.attr.windowNoTitle, android.R.attr.windowActionBar }
        );
        try {
            assertTrue("Platform title must be disabled", attributes.getBoolean(0, false));
            assertFalse("Platform action bar must be disabled", attributes.getBoolean(1, true));
        } finally {
            attributes.recycle();
        }
    }

    @Test
    public void applicationFallbackHasNoTitle() {
        assertEquals(R.style.AppTheme_NoActionBar, context.getApplicationInfo().theme);
        assertNoPlatformTitle(context.getApplicationInfo().theme);
    }

    @Test
    public void baseAndActivityThemesHaveNoTitle() {
        assertNoPlatformTitle(R.style.AppTheme);
        assertNoPlatformTitle(R.style.AppTheme_NoActionBar);
    }

    @Test
    public void launchThemeHandsOffToTitleFreeActivity() {
        assertNoPlatformTitle(R.style.AppTheme_NoActionBarLaunch);
        TypedArray attributes = new ContextThemeWrapper(context, R.style.AppTheme_NoActionBarLaunch)
            .obtainStyledAttributes(new int[] { androidx.core.splashscreen.R.attr.postSplashScreenTheme });
        try {
            assertEquals(R.style.AppTheme_NoActionBar, attributes.getResourceId(0, 0));
        } finally {
            attributes.recycle();
        }
    }

    @Test
    public void launchedWindowHasNoNativeTitleOrActionBar() throws Exception {
        // WebView animation can keep the main queue busy. Observe lifecycle
        // completion directly rather than requiring global UI idleness.
        LinkedBlockingQueue<MainActivity> resumed = new LinkedBlockingQueue<>();
        ActivityLifecycleCallback callback = (activity, stage) -> {
            if (activity instanceof MainActivity && stage == Stage.RESUMED) {
                resumed.offer((MainActivity) activity);
            }
        };
        ActivityLifecycleMonitorRegistry.getInstance().addLifecycleCallback(callback);
        MainActivity current = null;
        try {
            // Use the shell launch path, as in a real launcher cold start.
            // Vendor background-launch restrictions can block a test-context
            // startActivity call before it returns to the timeout below.
            try (ParcelFileDescriptor.AutoCloseInputStream output = new ParcelFileDescriptor.AutoCloseInputStream(
                InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(
                    "am start -W -n com.mintplot.app/.MainActivity"
                )
            )) {
                byte[] buffer = new byte[1024];
                while (output.read(buffer) != -1) { /* Drain the launch result. */ }
            }
            MainActivity initial = resumed.poll(10, TimeUnit.SECONDS);
            current = initial;
            assertNotNull("Activity must reach RESUMED", initial);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                assertTitleFreeWindow(initial);
                initial.recreate();
            });
            current = resumed.poll(10, TimeUnit.SECONDS);
            assertNotNull("Recreated activity must reach RESUMED", current);
            assertNotSame(initial, current);
            MainActivity recreated = current;
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> assertTitleFreeWindow(recreated));
        } finally {
            ActivityLifecycleMonitorRegistry.getInstance().removeLifecycleCallback(callback);
            if (current != null) {
                MainActivity last = current;
                InstrumentationRegistry.getInstrumentation().runOnMainSync(last::finish);
            }
        }
    }

    private void assertTitleFreeWindow(MainActivity activity) {
        assertTrue(activity.getWindow().hasFeature(Window.FEATURE_NO_TITLE));
        assertTrue(activity.getSupportActionBar() == null || !activity.getSupportActionBar().isShowing());
    }
}
