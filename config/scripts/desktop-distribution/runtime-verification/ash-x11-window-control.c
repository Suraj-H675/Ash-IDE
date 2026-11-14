// Observe and gracefully close only a real Ash top-level on a disposable X11
// server. The driver supplies its own private DISPLAY/XAUTHORITY and expected
// process ID; this helper never interacts with the user's live X11 desktop.
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  Display *display;
  Atom pid_atom;
  unsigned long expected_pid;
  Window matching_window;
  unsigned int width;
  unsigned int height;
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
    if (correct_class && correct_pid && attributes.width >= 500 &&
        attributes.height >= 300) {
      search->matches++;
      search->matching_window = window;
      search->width = (unsigned int)attributes.width;
      search->height = (unsigned int)attributes.height;
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

int main(int argc, char **argv) {
  if (argc != 3 || (strcmp(argv[1], "probe") != 0 &&
                    strcmp(argv[1], "close") != 0)) {
    fputs("Usage: ash-x11-window-control probe|close EXPECTED_ASH_PID\n", stderr);
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
  if (search.matches != 1) {
    fprintf(stderr, "Expected exactly one viewable Ash X11 top-level owned by "
                    "PID %lu, found %d\n", pid, search.matches);
    XCloseDisplay(display);
    return 1;
  }
  if (strcmp(argv[1], "probe") == 0) {
    printf("{\"ok\":true,\"nativeX11\":true,\"class\":\"com.ashide.desktop\","
           "\"pid\":%lu,\"window\":\"0x%lx\",\"width\":%u,\"height\":%u}\n",
           pid, search.matching_window, search.width, search.height);
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
