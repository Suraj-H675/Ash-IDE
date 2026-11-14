// Read the actual native X11 CLIPBOARD selection, never the X selection cache.
// Invoked only with the disposable Ash/Xvfb profile and a known test-only value.
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/select.h>

static int await_clipboard_reply(Display *display, Window window, Atom property) {
  for (int attempts = 0; attempts < 10; attempts++) {
    while (XPending(display)) {
      XEvent event;
      XNextEvent(display, &event);
      if (event.type == SelectionNotify && event.xselection.requestor == window) {
        if (event.xselection.property == property) return 1;
        return 0;
      }
    }
    fd_set fds;
    FD_ZERO(&fds);
    FD_SET(ConnectionNumber(display), &fds);
    struct timeval limit = {.tv_sec = 0, .tv_usec = 200000};
    const int result = select(ConnectionNumber(display) + 1, &fds, NULL, NULL, &limit);
    if (result < 0 && errno != EINTR) return 0;
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 2 || strlen(argv[1]) == 0 || strlen(argv[1]) > 1024) {
    fputs("Usage: ash-x11-clipboard-probe EXPECTED_TEST_STRING\n", stderr);
    return 2;
  }
  const char *profile = getenv("ASH_USER_DATA_PATH");
  const char *authority = getenv("XAUTHORITY");
  if (profile == NULL || authority == NULL ||
      strncmp(profile, "/var/tmp/ashx11.", sizeof("/var/tmp/ashx11.") - 1) != 0 ||
      strlen(profile) != sizeof("/var/tmp/ashx11.") - 1 + 6 + strlen("/profile") ||
      strcmp(profile + strlen(profile) - strlen("/profile"), "/profile") != 0 ||
      strncmp(authority, profile, strlen(profile) - strlen("/profile")) != 0 ||
      strcmp(authority + strlen(profile) - strlen("/profile"), "/Xauthority") != 0) {
    fputs("Refusing to inspect the user's real X11 clipboard\n", stderr);
    return 2;
  }
  Display *display = XOpenDisplay(NULL);
  if (display == NULL) {
    fputs("Private X11 display is unavailable\n", stderr);
    return 1;
  }
  const Atom clipboard = XInternAtom(display, "CLIPBOARD", False);
  const Atom utf8 = XInternAtom(display, "UTF8_STRING", False);
  const Atom property = XInternAtom(display, "ASH_TEST_PRIVATE_CLIPBOARD", False);
  if (XGetSelectionOwner(display, clipboard) == None) {
    fputs("No native X11 clipboard owner\n", stderr);
    XCloseDisplay(display);
    return 1;
  }
  const Window window = XCreateSimpleWindow(display, DefaultRootWindow(display),
                                             0, 0, 1, 1, 0, 0, 0);
  XConvertSelection(display, clipboard, utf8, property, window, CurrentTime);
  XFlush(display);
  if (!await_clipboard_reply(display, window, property)) {
    fputs("X11 clipboard selection owner refused UTF8_STRING or did not answer\n", stderr);
    XDestroyWindow(display, window);
    XCloseDisplay(display);
    return 1;
  }

  Atom actual = None;
  int format = 0;
  unsigned long items = 0, remaining = 0;
  unsigned char *data = NULL;
  const int result = XGetWindowProperty(display, window, property, 0, 512, True,
                                         AnyPropertyType, &actual, &format, &items,
                                         &remaining, &data);
  const int matched = result == Success && actual == utf8 && format == 8 &&
                      remaining == 0 && items == strlen(argv[1]) && data != NULL &&
                      memcmp(data, argv[1], items) == 0;
  if (data != NULL) XFree(data);
  XDestroyWindow(display, window);
  XCloseDisplay(display);
  if (!matched) {
    fputs("Native X11 clipboard did not contain the expected test text\n", stderr);
    return 1;
  }
  puts("{\"ok\":true,\"nativeClipboardRead\":true,\"exactTextMatched\":true}");
  return 0;
}
