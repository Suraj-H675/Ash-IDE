#define _XOPEN_SOURCE 700

#include <gio/gio.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static gchar *fixture_root;
static GMainLoop *loop;
static gboolean failed;
static guint recorded_stages;

static const gchar XML[] =
    "<node><interface name='org.ashide.PrivateLifecycleObserver'>"
    "<method name='RecordWindowCount'>"
    "<arg type='s' direction='in'/><arg type='i' direction='in'/>"
    "<arg type='s' direction='in'/></method>"
    "</interface></node>";

static const gchar *evidence_name(const gchar *stage) {
  if (g_str_equal(stage, "before-close")) return "wayland-window-before-close.json";
  if (g_str_equal(stage, "closed-before-browser"))
    return "wayland-window-closed-before-browser.json";
  if (g_str_equal(stage, "closed-after-browser"))
    return "wayland-window-closed-after-browser.json";
  if (g_str_equal(stage, "reopened")) return "wayland-window-reopened.json";
  return NULL;
}

static void record_window_count(GDBusMethodInvocation *invocation,
                               GVariant *arguments) {
  const gchar *stage;
  const gchar *app_ids;
  gint count;
  g_variant_get(arguments, "(&si&s)", &stage, &count, &app_ids);
  const gchar *file_name = evidence_name(stage);
  const gint expected_count =
      g_str_equal(stage, "before-close") || g_str_equal(stage, "reopened") ? 1 : 0;
  const gchar *expected_ids = expected_count == 1 ? "com.ashide.desktop" : "";
  const gchar *stages[] = {"before-close", "closed-before-browser", "closed-after-browser", "reopened"};
  if (file_name == NULL || recorded_stages >= G_N_ELEMENTS(stages) ||
      !g_str_equal(stage, stages[recorded_stages]) || count != expected_count ||
      !g_str_equal(app_ids, expected_ids)) {
    failed = TRUE;
  }
  if (file_name == NULL) {
    g_dbus_method_invocation_return_dbus_error(
        invocation, "org.ashide.PrivateLifecycleObserver.InvalidStage",
        "Unexpected QA window observation stage");
    return;
  }
  gchar *evidence_path = g_build_filename(fixture_root, file_name, NULL);
  gchar *evidence = g_strdup_printf(
      "{\"ok\":%s,\"nativeWayland\":true,\"stage\":\"%s\","
      "\"nativeAshWindows\":%d,\"appIds\":\"%s\"}\n",
      failed ? "false" : "true", stage, count,
      g_str_equal(app_ids, "com.ashide.desktop") ? app_ids : "");
  const gboolean saved = g_file_set_contents(evidence_path, evidence, -1, NULL);
  g_free(evidence);
  g_free(evidence_path);
  if (!saved) failed = TRUE;
  recorded_stages++;
  if (g_str_equal(stage, "reopened")) {
    g_main_loop_quit(loop);
  }
  if (failed) {
    g_dbus_method_invocation_return_dbus_error(
        invocation, "org.ashide.PrivateLifecycleObserver.WindowCountMismatch",
        "Native Wayland window count did not match the expected stage");
    return;
  }
  g_dbus_method_invocation_return_value(invocation, NULL);
}

static void on_call(GDBusConnection *connection, const gchar *sender,
                    const gchar *object_path, const gchar *interface_name,
                    const gchar *method, GVariant *arguments,
                    GDBusMethodInvocation *invocation, gpointer user_data) {
  (void)connection;
  (void)sender;
  (void)object_path;
  (void)interface_name;
  (void)user_data;
  if (!g_str_equal(method, "RecordWindowCount")) {
    g_dbus_method_invocation_return_dbus_error(
        invocation, "org.freedesktop.DBus.Error.UnknownMethod",
        "Unsupported QA observer method");
    return;
  }
  record_window_count(invocation, arguments);
}

static const GDBusInterfaceVTable VTABLE = {.method_call = on_call};

static void on_bus(GDBusConnection *connection, const gchar *name, gpointer user_data) {
  (void)name;
  (void)user_data;
  GError *error = NULL;
  GDBusNodeInfo *node = g_dbus_node_info_new_for_xml(XML, &error);
  if (node == NULL ||
      !g_dbus_connection_register_object(
          connection, "/org/ashide/PrivateLifecycleObserver", node->interfaces[0],
          &VTABLE, NULL, NULL, &error)) {
    g_printerr("Private Wayland window observer could not register\n");
    failed = TRUE;
    if (error != NULL) g_error_free(error);
    g_main_loop_quit(loop);
  }
  if (node != NULL) g_dbus_node_info_unref(node);
}

static void on_name(GDBusConnection *connection, const gchar *name, gpointer user_data) {
  (void)connection;
  (void)name;
  (void)user_data;
  gchar *ready = g_build_filename(fixture_root, "wayland-window-observer-ready", NULL);
  if (!g_file_set_contents(ready, "ready\n", -1, NULL)) {
    failed = TRUE;
    g_main_loop_quit(loop);
  }
  g_free(ready);
}

static void on_lost(GDBusConnection *connection, const gchar *name, gpointer user_data) {
  (void)connection;
  (void)name;
  (void)user_data;
  failed = TRUE;
  g_main_loop_quit(loop);
}

int main(int argc, char **argv) {
  const gchar *bus = g_getenv("DBUS_SESSION_BUS_ADDRESS");
  const gchar *configured_root = g_getenv("ASH_TEST_PRIVATE_ROOT");
  const gchar *private_root = configured_root == NULL ? "/var/tmp" : configured_root;
  char canonical_root[PATH_MAX];
  char canonical_fixture[PATH_MAX];
  struct stat fixture_stat;
  if (argc != 2 || bus == NULL ||
      realpath(private_root, canonical_root) == NULL ||
      realpath(argv[1], canonical_fixture) == NULL ||
      stat(argv[1], &fixture_stat) != 0 || !S_ISDIR(fixture_stat.st_mode) ||
      fixture_stat.st_uid != getuid() || (fixture_stat.st_mode & 0777) != 0700) {
    g_printerr("Refusing Wayland observer outside a private desktop fixture\n");
    return 2;
  }
  gchar *fixture_parent = g_path_get_dirname(canonical_fixture);
  gchar *fixture_name = g_path_get_basename(canonical_fixture);
  const gboolean valid_fixture =
      g_str_equal(fixture_parent, canonical_root) &&
      g_str_has_prefix(fixture_name, "ashwl.") && strlen(fixture_name) == 12;
  g_free(fixture_parent);
  g_free(fixture_name);
  if (!valid_fixture) {
    g_printerr("Wayland observer fixture is outside the requested private root\n");
    return 2;
  }
  gchar *expected_bus = g_strdup_printf(
      "unix:path=%s/run/dbus-session.sock", argv[1]);
  const gchar *suffix = g_str_has_prefix(bus, expected_bus) ? bus + strlen(expected_bus) : NULL;
  const gboolean private_bus = suffix != NULL &&
      (*suffix == '\0' || (g_str_has_prefix(suffix, ",guid=") &&
       strlen(suffix + 6) == 32 && strspn(suffix + 6, "0123456789abcdefABCDEF") == 32));
  g_free(expected_bus);
  if (!private_bus) {
    g_printerr("Wayland observer requires the test-owned private D-Bus socket\n");
    return 2;
  }
  gchar *marker = g_build_filename(argv[1], ".ash-desktop-lifecycle-fixture", NULL);
  if (access(marker, F_OK) != 0) {
    g_free(marker);
    g_printerr("Wayland observer fixture marker is missing\n");
    return 2;
  }
  g_free(marker);
  fixture_root = g_strdup(argv[1]);
  loop = g_main_loop_new(NULL, FALSE);
  const guint owner = g_bus_own_name(
      G_BUS_TYPE_SESSION, "org.ashide.PrivateLifecycleObserver",
      G_BUS_NAME_OWNER_FLAGS_NONE, on_bus, on_name, on_lost, NULL, NULL);
  g_main_loop_run(loop);
  g_bus_unown_name(owner);
  g_main_loop_unref(loop);
  g_free(fixture_root);
  return failed || recorded_stages != 4 ? 1 : 0;
}
