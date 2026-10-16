// MMScripts — dockable After Effects panel (loader).
//
// Install: copy this file (and, optionally, the "MMScripts" folder next to it) into
//   Windows: C:\Program Files\Adobe\Adobe After Effects <ver>\Support Files\Scripts\ScriptUI Panels\
//   macOS:   /Applications/Adobe After Effects <ver>/Scripts/ScriptUI Panels/
// then open it from Window > MMScripts.jsx.
//
// This file only boots the toolkit. The real UI (core.jsx) and every tool live in
//   <user data>/MMScripts/
// and are replaced by the Update button, so this loader never needs to change.

(function (thisObj) {
    var DATA_DIR = new Folder(Folder.userData.fsName + "/MMScripts");
    var BUNDLE_DIR = new Folder(File($.fileName).parent.fsName + "/MMScripts");
    var DEFAULTS = { repo: "mmosadegh/Plugins", branch: "HEAD", path: "MMScripts", token: "" };

    var panel = (thisObj instanceof Panel)
        ? thisObj
        : new Window("palette", "MMScripts", undefined, { resizeable: true });

    panel.onResizing = panel.onResize = function () { this.layout.resize(); };

    function clearPanel() {
        while (panel.children.length) panel.remove(panel.children[0]);
    }

    function showMessage(lines) {
        clearPanel();
        panel.orientation = "column";
        panel.alignChildren = ["fill", "top"];
        var txt = panel.add("statictext", undefined, lines.join("\n"), { multiline: true });
        txt.preferredSize = [260, 120];
        var retry = panel.add("button", undefined, "Retry");
        retry.onClick = load;
        panel.layout.layout(true);
    }

    function copyFolder(src, dst) {
        if (!dst.exists) dst.create();
        var items = src.getFiles();
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var target = dst.fsName + "/" + it.name;
            if (it instanceof Folder) copyFolder(it, new Folder(target));
            else it.copy(target);
        }
    }

    // First run without a bundled folder: fetch core.jsx; core then pulls the tools itself.
    function downloadCore() {
        var url = "https://raw.githubusercontent.com/" + DEFAULTS.repo + "/" + DEFAULTS.branch + "/" +
            DEFAULTS.path + "/core.jsx?t=" + new Date().getTime();
        var out = DATA_DIR.fsName + "/core.jsx";
        var cmd = ($.os.indexOf("Windows") !== -1)
            ? 'cmd.exe /c curl.exe -fsSL -o "' + out + '" "' + url + '"'
            : "curl -fsSL -o '" + out + "' '" + url + "'";
        try { system.callSystem(cmd); } catch (e) {}
    }

    function manifestVersion(dir) {
        var f = new File(dir.fsName + "/manifest.json");
        if (!f.exists || !f.open("r")) return "";
        var text = f.read();
        f.close();
        var m = text.match(/"version"\s*:\s*"([^"]+)"/);
        return m ? m[1] : "";
    }

    function newer(a, b) { // is version a > b ?
        var x = a.split("."), y = b.split(".");
        for (var i = 0; i < Math.max(x.length, y.length); i++) {
            var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
            if (d) return d > 0;
        }
        return false;
    }

    function load() {
        if (!DATA_DIR.exists) DATA_DIR.create();
        var core = new File(DATA_DIR.fsName + "/core.jsx");

        // A bundled copy newer than the installed one (manual install from ZIP) wins.
        if (BUNDLE_DIR.exists && (!core.exists || newer(manifestVersion(BUNDLE_DIR), manifestVersion(DATA_DIR)))) {
            copyFolder(BUNDLE_DIR, DATA_DIR);
        }
        if (!core.exists) downloadCore();
        if (!core.exists) {
            showMessage([
                "MMScripts could not find its files.",
                "",
                "Either copy the MMScripts folder next to this panel file,",
                "or enable Edit > Preferences > Scripting & Expressions >",
                "'Allow Scripts to Write Files and Access Network' and press Retry."
            ]);
            return;
        }

        try {
            $.evalFile(core);
            $.global.MM.boot(panel, { dataDir: DATA_DIR, defaults: DEFAULTS, reload: load });
        } catch (err) {
            showMessage(["MMScripts failed to start:", String(err), "line: " + (err.line || "?")]);
        }
    }

    load();

    if (panel instanceof Window) {
        panel.center();
        panel.show();
    }
})(this);
