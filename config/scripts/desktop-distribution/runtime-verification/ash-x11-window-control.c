// Observe and gracefully close only a real Ash top-level on a disposable X11
// server. An optional test-only Return key confirms the running-PTY dialog.
// The driver supplies private DISPLAY/XAUTHORITY and the expected Ash PID;
// the synthetic input path additionally requires the owned fixture profile.
#define _XOPEN_SOURCE 700

#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/XTest.h>
#include <X11/keysym.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct {
  Display *display;
  Atom pid_atom;
  unsigned long expected_pid;
  Window matching_window;
  unsigned int width;
  unsigned int height;
  int ash_windows;
  int matches;
} Search;

static unsigned long window_pid(Search *search, Window window) {
  if (search->pid_atom == None) return 0;
  Atom actual_type = None;
  int actual_format = 0;
  unsigned long count = 0, remaining = 0;
  unsigned char *data = NULL;
  const int result = XGetWindowProperty(
      search->display, window, search->pid_atom, 0, 1, False, XA_CARDINAL,
      &actual_type, &actual_format, &count, &remaining, &data);
  unsigned long pid = 0;
  if (result == Success && actual_type == XA_CARDINAL &&
      actual_format == 32 && count == 1 && data != NULL) {
    pid = *(const unsigned long *)data;
  }
  if (data != NULL) XFree(data);
  return pid;
}

static void examine(Search *search, Window window, int depth) {
  if (depth > 10) return;
  XWindowAttributes attributes;
  if (XGetWindowAttributes(search->display, window, &attributes) == 0) return;

  XClassHint hint = {0};
  if (attributes.map_state == IsViewable &&
      XGetClassHint(search->display, window, &hint) != 0) {
    const int correct_class =
        hint.res_class != NULL && strcmp(hint.res_class, "com.ashide.desktop") == 0;
    const int correct_pid = window_pid(search, window) == search->expected_pid;
    if (correct_class && correct_pid) {
      search->ash_windows++;
      if (attributes.width >= 500 && attributes.height >= 300) {
        search->matches++;
        search->matching_window = window;
        search->width = (unsigned int)attributes.width;
        search->height = (unsigned int)attributes.height;
      }
    }
    if (hint.res_name != NULL) XFree(hint.res_name);
    if (hint.res_class != NULL) XFree(hint.res_class);
  }

  Window root, parent, *children = NULL;
  unsigned int count = 0;
  if (XQueryTree(search->display, window, &root, &parent, &children, &count) == 0)
    return;
  for (unsigned int index = 0; index < count; index++)
    examine(search, children[index], depth + 1);
  if (children != NULL) XFree(children);
}

static int private_fixture_paths_match(void) {
  const char *authority = getenv("XAUTHORITY");
  const char *profile = getenv("ASH_USER_DATA_PATH");
  const char *private_root = getenv("ASH_TEST_PRIVATE_ROOT");
  if (private_root == NULL) private_root = "/var/tmp";
  char canonical_root[PATH_MAX];
  char canonical_profile[PATH_MAX];
  char canonical_authority[PATH_MAX];
  if (private_root == NULL || authority == NULL || profile == NULL ||
      realpath(private_root, canonical_root) == NULL ||
      realpath(profile, canonical_profile) == NULL ||
      realpath(authority, canonical_authority) == NULL) {
    return 0;
  }
  const size_t root_length = strlen(canonical_root);
  if (strncmp(canonical_profile, canonical_root, root_length) != 0 ||
      canonical_profile[root_length] != '/') {
    return 0;
  }
  char fixture[PATH_MAX];
  if (snprintf(fixture, sizeof(fixture), "%s", canonical_profile) >=
      (int)sizeof(fixture)) {
    return 0;
  }
  char *profile_suffix = strrchr(fixture, '/');
  if (profile_suffix == NULL || strcmp(profile_suffix, "/profile") != 0) {
    return 0;
  }
  *profile_suffix = '\0';
  const char *fixture_name = strrchr(fixture, '/');
  fixture_name = fixture_name == NULL ? fixture : fixture_name + 1;
  if (strlen(fixture_name) != 13 || strncmp(fixture_name, "ashx11.", 7) != 0 ||
      strspn(fixture_name + 7,
             "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") != 6) {
    return 0;
  }
  char expected_fixture[PATH_MAX];
  if (snprintf(expected_fixture, sizeof(expected_fixture), "%s/%s", canonical_root,
               fixture_name) >= (int)sizeof(expected_fixture) ||
      strcmp(fixture, expected_fixture) != 0) {
    return 0;
  }
  char expected_authority[PATH_MAX];
  if (snprintf(expected_authority, sizeof(expected_authority), "%s/Xauthority", fixture) >=
          (int)sizeof(expected_authority) ||
      strcmp(canonical_authority, expected_authority) != 0) {
    return 0;
  }
  char marker[PATH_MAX];
  if (snprintf(marker, sizeof(marker), "%s/.ash-desktop-lifecycle-fixture", fixture) >=
          (int)sizeof(marker) ||
      access(marker, F_OK) != 0) {
    return 0;
  }
  return 1;
}

int main(int argc, char **argv) {
  if (argc != 3 || (strcmp(argv[1], "probe") != 0 &&
                    strcmp(argv[1], "probe-closed") != 0 &&
                    strcmp(argv[1], "close") != 0 &&
                    strcmp(argv[1], "send-return") != 0)) {
    fputs("Usage: ash-x11-window-control probe|probe-closed|close|send-return EXPECTED_ASH_PID\n", stderr);
    return 2;
  }
  char *end = NULL;
  errno = 0;
  const unsigned long pid = strtoul(argv[2], &end, 10);
  if (errno != 0 || end == argv[2] || *end != '\0' || pid == 0 || pid > INT_MAX) {
    fputs("Invalid expected PID\n", stderr);
    return 2;
  }
  Display *display = XOpenDisplay(NULL);
  if (display == NULL) {
    fputs("Cannot connect to the disposable X11 display\n", stderr);
    return 1;
  }
  Search search = {
      .display = display,
      .pid_atom = XInternAtom(display, "_NET_WM_PID", True),
      .expected_pid = pid,
  };
  examine(&search, DefaultRootWindow(display), 0);
  if (strcmp(argv[1], "probe-closed") == 0) {
    if (search.ash_windows != 0) {
      fprintf(stderr, "Expected no viewable Ash X11 top-levels owned by PID %lu, found %d\n",
              pid, search.ash_windows);
      XCloseDisplay(display);
      return 1;
    }
    printf("{\"ok\":true,\"nativeX11\":true,\"nativeAshWindows\":0,\"pid\":%lu}\n", pid);
    XCloseDisplay(display);
    return 0;
  }
  const int requires_single_window = strcmp(argv[1], "send-return") != 0;
  if (search.matches != 1 || (requires_single_window && search.ash_windows != 1)) {
    fprintf(stderr, "Expected exactly one viewable Ash X11 top-level owned by "
                    "PID %lu and no other Ash windows, found %d Ash windows and %d main windows\n",
            pid, search.ash_windows, search.matches);
    XCloseDisplay(display);
    return 1;
  }
  if (strcmp(argv[1], "probe") == 0) {
    printf("{\"ok\":true,\"nativeX11\":true,\"class\":\"com.ashide.desktop\","
           "\"nativeAshWindows\":1,\"pid\":%lu,\"window\":\"0x%lx\","
           "\"width\":%u,\"height\":%u}\n",
           pid, search.matching_window, search.width, search.height);
  } else if (strcmp(argv[1], "send-return") == 0) {
    // Only a private, test-owned native Xvfb server may receive synthetic input.
    if (!private_fixture_paths_match()) {
      fputs("Synthetic Return requires the private X11 test fixture\n", stderr);
      XCloseDisplay(display);
      return 2;
    }
    int event_base = 0, error_base = 0, major_version = 0, minor_version = 0;
    if (XTestQueryExtension(display, &event_base, &error_base,
                            &major_version, &minor_version) == False) {
      fputs("XTest extension is unavailable on this private X11 server\n", stderr);
      XCloseDisplay(display);
      return 1;
    }
    const KeyCode keycode = XKeysymToKeycode(display, XK_Return);
    if (keycode == 0) {
      fputs("X11 Return key is unavailable\n", stderr);
      XCloseDisplay(display);
      return 1;
    }
    XSetInputFocus(display, search.matching_window, RevertToParent, CurrentTime);
    XSync(display, False);
    if (XTestFakeKeyEvent(display, keycode, True, CurrentTime) == 0 ||
        XTestFakeKeyEvent(display, keycode, False, CurrentTime) == 0) {
      fputs("Could not send private X11 Return key\n", stderr);
      XCloseDisplay(display);
      return 1;
    }
    XFlush(display);
    printf("{\"ok\":true,\"returnSent\":true,\"window\":\"0x%lx\"}\n",
           search.matching_window);
  } else {
    const Atom wm_protocols = XInternAtom(display, "WM_PROTOCOLS", False);
    const Atom delete_window = XInternAtom(display, "WM_DELETE_WINDOW", False);
    Atom *protocols = NULL;
    int count = 0, supports_delete = 0;
    if (XGetWMProtocols(display, search.matching_window, &protocols, &count) != 0) {
      for (int index = 0; index < count; index++) {
        if (protocols[index] == delete_window) supports_delete = 1;
      }
      if (protocols != NULL) XFree(protocols);
    }
    if (!supports_delete) {
      fputs("Ash X11 window does not support a graceful WM_DELETE_WINDOW\n", stderr);
      XCloseDisplay(display);
      return 1;
    }
    XEvent event = {0};
    event.xclient.type = ClientMessage;
    event.xclient.window = search.matching_window;
    event.xclient.message_type = wm_protocols;
    event.xclient.format = 32;
    event.xclient.data.l[0] = (long)delete_window;
    event.xclient.data.l[1] = CurrentTime;
    if (XSendEvent(display, search.matching_window, False, NoEventMask, &event) == 0) {
      fputs("Failed to send a graceful X11 close request\n", stderr);
      XCloseDisplay(display);
      return 1;
    }
    XFlush(display);
    printf("{\"ok\":true,\"closeRequestSent\":true,\"window\":\"0x%lx\"}\n",
           search.matching_window);
  }
  XCloseDisplay(display);
  return 0;
}
