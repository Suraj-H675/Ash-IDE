// A disposable, private D-Bus org.freedesktop.Notifications receiver used only
// by QA. Never own the real desktop session bus. Record matches, not messages.
#include <gio/gio.h>
#include <sys/stat.h>
#include <unistd.h>
#include <string.h>

static const gchar *expected_title;
static const gchar *expected_body;
static gchar *fixture_root;
static GMainLoop *loop;

static const gchar XML[] =
    "<node><interface name='org.freedesktop.Notifications'>"
    "<method name='GetCapabilities'><arg type='as' direction='out'/></method>"
    "<method name='GetServerInformation'>"
    "<arg type='s' direction='out'/><arg type='s' direction='out'/>"
    "<arg type='s' direction='out'/><arg type='s' direction='out'/></method>"
    "<method name='Notify'>"
    "<arg type='s' direction='in'/><arg type='u' direction='in'/>"
    "<arg type='s' direction='in'/><arg type='s' direction='in'/>"
    "<arg type='s' direction='in'/><arg type='as' direction='in'/>"
    "<arg type='a{sv}' direction='in'/><arg type='i' direction='in'/>"
    "<arg type='u' direction='out'/></method>"
    "</interface></node>";

static void on_call(GDBusConnection *connection, const gchar *sender,
                    const gchar *object_path, const gchar *interface_name,
                    const gchar *method, GVariant *args,
                    GDBusMethodInvocation *invocation, gpointer user_data) {
  (void)connection;
  (void)sender;
  (void)object_path;
  (void)interface_name;
  (void)user_data;
  if (g_str_equal(method, "GetCapabilities")) {
    const gchar *capabilities[] = {"body", NULL};
    g_dbus_method_invocation_return_value(
        invocation, g_variant_new("(@as)", g_variant_new_strv(capabilities, -1)));
    return;
  }
  if (g_str_equal(method, "GetServerInformation")) {
    g_dbus_method_invocation_return_value(
        invocation, g_variant_new("(ssss)", "Ash Private QA", "Ash IDE", "1.0", "1.2"));
    return;
  }
  if (g_str_equal(method, "Notify")) {
    GVariant *app = g_variant_get_child_value(args, 0);
    GVariant *title = g_variant_get_child_value(args, 3);
    GVariant *body = g_variant_get_child_value(args, 4);
    const gboolean valid =
        g_str_equal(g_variant_get_string(app, NULL), "Ash IDE") &&
        g_str_equal(g_variant_get_string(title, NULL), expected_title) &&
        g_str_equal(g_variant_get_string(body, NULL), expected_body);
    g_variant_unref(app);
    g_variant_unref(title);
    g_variant_unref(body);
    if (!valid) {
      g_dbus_method_invocation_return_dbus_error(
          invocation, "org.ashide.PrivateQATestMismatch", "Unexpected notification fields");
      return;
    }
    gchar *evidence = g_build_filename(fixture_root, "native-notification.json", NULL);
    const gboolean saved = g_file_set_contents(
        evidence, "{\"ok\":true,\"nativeDBusReceived\":true,"
                  "\"appNameMatched\":true,\"exactContentMatched\":true}\n",
        -1, NULL);
    g_free(evidence);
    if (!saved) {
      g_dbus_method_invocation_return_dbus_error(
          invocation, "org.ashide.PrivateQATestWriteFailed", "Evidence write failed");
      return;
    }
    g_dbus_method_invocation_return_value(invocation, g_variant_new("(u)", 1U));
    return;
  }
  g_dbus_method_invocation_return_dbus_error(
      invocation, "org.freedesktop.DBus.Error.UnknownMethod", "Unsupported QA method");
}

static const GDBusInterfaceVTable VTABLE = {.method_call = on_call};

static void on_bus(GDBusConnection *connection, const gchar *name, gpointer user_data) {
  (void)name;
  (void)user_data;
  GError *error = NULL;
  GDBusNodeInfo *node = g_dbus_node_info_new_for_xml(XML, &error);
  if (!node || !g_dbus_connection_register_object(
                  connection, "/org/freedesktop/Notifications",
                  node->interfaces[0], &VTABLE, NULL, NULL, &error)) {
    g_printerr("Private D-Bus notification sink could not register\n");
    if (error) g_error_free(error);
    g_main_loop_quit(loop);
  }
  if (node) g_dbus_node_info_unref(node);
}

static void on_name(GDBusConnection *connection, const gchar *name, gpointer user_data) {
  (void)connection;
  (void)name;
  (void)user_data;
  gchar *ready = g_build_filename(fixture_root, "dbus-notification-ready", NULL);
  if (!g_file_set_contents(ready, "ready\n", -1, NULL)) g_main_loop_quit(loop);
  g_free(ready);
}

static void on_lost(GDBusConnection *connection, const gchar *name, gpointer user_data) {
  (void)connection;
  (void)name;
  (void)user_data;
  g_main_loop_quit(loop);
}

int main(int argc, char **argv) {
  // Do not allow a standalone invocation to claim the real user's D-Bus
  // notification name. dbus-run-session puts this test bus under /tmp/dbus-*;
  // the user's ordinary desktop bus is under /run/user/<uid>/bus.
  const gchar *bus = g_getenv("DBUS_SESSION_BUS_ADDRESS");
  if (bus == NULL || !g_str_has_prefix(bus, "unix:path=/tmp/dbus-")) {
    g_printerr("Refusing to own a notification name on the user's desktop bus\n");
    return 2;
  }
  if (argc != 4 || !g_str_has_prefix(argv[1], "/var/tmp/ashnotify.") ||
      strlen(argv[1]) != strlen("/var/tmp/ashnotify.") + 6 ||
      strspn(argv[1] + strlen("/var/tmp/ashnotify."),
             "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") != 6) {
    g_printerr("Refusing to listen outside a disposable Ash notification fixture\n");
    return 2;
  }
  struct stat st;
  if (stat(argv[1], &st) != 0 || !S_ISDIR(st.st_mode) ||
      st.st_uid != getuid() || (st.st_mode & 0777) != 0700) {
    g_printerr("Private notification fixture is not owned and mode 0700\n");
    return 2;
  }
  fixture_root = argv[1];
  expected_title = argv[2];
  expected_body = argv[3];
  loop = g_main_loop_new(NULL, FALSE);
  const guint owner = g_bus_own_name(G_BUS_TYPE_SESSION, "org.freedesktop.Notifications",
                                       G_BUS_NAME_OWNER_FLAGS_NONE, on_bus, on_name,
                                       on_lost, NULL, NULL);
  g_main_loop_run(loop);
  g_bus_unown_name(owner);
  g_main_loop_unref(loop);
  return 0;
}
