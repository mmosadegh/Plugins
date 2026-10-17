// MMScripts core: builds the panel, loads tools, and updates itself from GitHub.
// ExtendScript is ES3: no let/const, no JSON, no Array.indexOf/forEach, no String.trim.
//
// A tool is a file in tools/ that calls:
//   MM.register({
//       id: "my_tool",
//       name: "My Tool",
//       build: function (group, api) { ... add controls to group ... }
//   });
// `api` gives tools: comp(), status(), undo(), util.*

$.global.MM = (function () {
    var T = { tools: [] };
    var state = { panel: null, dataDir: null, defaults: null, reload: null, statusText: null };

    T.register = function (tool) { T.tools.push(tool); };

    // ---------- files & settings ----------

    function readText(file) {
        file.encoding = "UTF-8";
        if (!file.open("r")) return null;
        var s = file.read();
        file.close();
        return s;
    }

    function writeText(file, text) {
        file.encoding = "UTF-8";
        if (!file.open("w")) return false;
        file.write(text);
        file.close();
        return true;
    }

    function parseJSON(text) {
        return eval("(" + text + ")");
    }

    function quote(s) {
        return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    function settingsFile() { return new File(state.dataDir.fsName + "/settings.json"); }

    // Only these are user settings. Anything else (like the repo path) always comes from
    // the loader, so a stale value saved by an older version can't break updates.
    var USER_KEYS = ["repo", "branch", "token", "proxy"];

    function loadSettings() {
        var s = {}, k, i, d = state.defaults;
        for (k in d) s[k] = d[k];
        var f = settingsFile();
        if (f.exists) {
            try {
                var saved = parseJSON(readText(f));
                for (i = 0; i < USER_KEYS.length; i++) {
                    k = USER_KEYS[i];
                    if (saved[k] !== undefined) s[k] = saved[k];
                }
            } catch (e) {}
        }
        if (s.repo === "mmosadegh/TTT") s.repo = d.repo; // the toolkit moved out of TTT
        return s;
    }

    function saveSettings(s) {
        var parts = [];
        for (var i = 0; i < USER_KEYS.length; i++) {
            parts.push(quote(USER_KEYS[i]) + ": " + quote(s[USER_KEYS[i]] || ""));
        }
        writeText(settingsFile(), "{\n  " + parts.join(",\n  ") + "\n}\n");
    }

    function localManifest() {
        var f = new File(state.dataDir.fsName + "/manifest.json");
        if (!f.exists) return null;
        try { return parseJSON(readText(f)); } catch (e) { return null; }
    }

    function toolFiles(manifest) {
        var out = [], i;
        if (manifest && manifest.files) {
            for (i = 0; i < manifest.files.length; i++) {
                if (manifest.files[i].indexOf("tools/") === 0) out.push(manifest.files[i]);
            }
            return out;
        }
        var dir = new Folder(state.dataDir.fsName + "/tools");
        var found = dir.exists ? dir.getFiles("*.jsx") : [];
        for (i = 0; i < found.length; i++) out.push("tools/" + found[i].name);
        out.sort();
        return out;
    }

    // ---------- network ----------

    function networkAllowed() {
        try {
            return app.preferences.getPrefAsLong("Main Pref Section", "Pref_SCRIPTING_FILE_NETWORK_SECURITY") === 1;
        } catch (e) {
            return true; // unknown pref key on this version: just try
        }
    }

    var isWin = $.os.indexOf("Windows") !== -1;
    var lastError = "";

    function sh(cmd) {
        try { return String(system.callSystem(cmd) || ""); } catch (e) { return String(e); }
    }

    // curl ignores the OS proxy (VPN apps often set one), so read it ourselves.
    function systemProxy() {
        var out, m;
        if (isWin) {
            out = sh('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"');
            if (!/ProxyEnable\s+REG_DWORD\s+0x1/.test(out)) return "";
            m = out.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
            if (!m) return "";
            var v = m[1];
            if (v.indexOf("=") === -1) return "http://" + v;
            m = v.match(/https=([^;]+)/) || v.match(/http=([^;]+)/);
            if (m) return "http://" + m[1];
            m = v.match(/socks=([^;]+)/);
            return m ? "socks5h://" + m[1] : "";
        }
        out = sh("/usr/sbin/scutil --proxy");
        function get(key) { var r = out.match(new RegExp(key + " : (\\S+)")); return r ? r[1] : ""; }
        if (get("HTTPSEnable") === "1" && get("HTTPSProxy")) return "http://" + get("HTTPSProxy") + ":" + get("HTTPSPort");
        if (get("HTTPEnable") === "1" && get("HTTPProxy")) return "http://" + get("HTTPProxy") + ":" + get("HTTPPort");
        if (get("SOCKSEnable") === "1" && get("SOCKSProxy")) return "socks5h://" + get("SOCKSProxy") + ":" + get("SOCKSPort");
        return "";
    }

    // settings.proxy: "" = use the system proxy if any, "none" = direct, otherwise a proxy URL.
    function proxyCandidates(s) {
        var p = s.proxy || "";
        if (p === "none") return [""];
        if (p) return [p];
        var sys = systemProxy();
        return sys ? [sys, ""] : [""];
    }

    function curlOnce(url, file, token, proxy) {
        var q = isWin ? '"' : "'";
        var cmd = (isWin ? "cmd.exe /c curl.exe" : "/usr/bin/curl") +
            " -sS -f -L --connect-timeout 15 --max-time 90" +
            (proxy ? " -x " + q + proxy + q : "") +
            (token ? " -H " + q + "Authorization: token " + token + q : "") +
            " -o " + q + file.fsName + q + " " + q + url + q + " 2>&1";
        var out = sh(cmd);
        var ok = file.exists && file.length > 0;
        if (!ok) lastError = (proxy ? "[proxy " + proxy + "] " : "[direct] ") + (out.replace(/^\s+|\s+$/g, "") || "no output");
        return ok;
    }

    function download(url, file, token, proxies) {
        lastError = "";
        for (var i = 0; i < proxies.length; i++) {
            if (file.exists) file.remove();
            if (curlOnce(url, file, token, proxies[i])) return true;
        }
        if (isWin && !file.exists) {
            // Old Windows without curl.exe.
            sh('powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing -Uri \'' + url +
                "' -OutFile '" + file.fsName + "'" + (token ? " -Headers @{Authorization='token " + token + "'}" : "") + '"');
        }
        return file.exists && file.length > 0;
    }

    function rawUrl(s, rel) {
        return "https://raw.githubusercontent.com/" + s.repo + "/" + s.branch + "/" + s.path + "/" + rel +
            "?t=" + new Date().getTime();
    }

    function ensureFolder(path) {
        var f = new Folder(path);
        if (!f.exists) f.create();
        return f;
    }

    function update() {
        if (!networkAllowed()) {
            alert("Enable Edit > Preferences > Scripting & Expressions >\n" +
                "'Allow Scripts to Write Files and Access Network', then press Update again.", "MMScripts");
            return;
        }
        var s = loadSettings();
        var oldManifest = localManifest();
        var stage = ensureFolder(state.dataDir.fsName + "/_staging");
        ensureFolder(stage.fsName + "/tools");
        setStatus("Checking " + s.repo + "@" + s.branch + " ...");

        var proxies = proxyCandidates(s);
        var mFile = new File(stage.fsName + "/manifest.json");
        if (!download(rawUrl(s, "manifest.json"), mFile, s.token, proxies)) {
            setStatus("Update failed: could not reach GitHub.");
            alert("Could not download manifest.json from\n" + s.repo + " (branch: " + s.branch + ").\n\n" +
                "Check your internet connection and the repo/branch in Settings.\n" +
                "If you use a VPN/proxy, put its address in Settings > Proxy\n(e.g. http://127.0.0.1:10809).\n\n" +
                "Error: " + lastError, "MMScripts");
            return;
        }
        var manifest;
        try { manifest = parseJSON(readText(mFile)); } catch (e) {
            setStatus("Update failed: bad manifest.");
            return;
        }

        var i, rel;
        for (i = 0; i < manifest.files.length; i++) {
            rel = manifest.files[i];
            setStatus("Downloading " + rel + " ...");
            if (!download(rawUrl(s, rel), new File(stage.fsName + "/" + rel), s.token, proxies)) {
                setStatus("Update failed on " + rel + ". Nothing was changed.");
                return;
            }
        }

        // Everything downloaded: swap it in.
        ensureFolder(state.dataDir.fsName + "/tools");
        var keep = {};
        for (i = 0; i < manifest.files.length; i++) {
            rel = manifest.files[i];
            keep[rel] = true;
            var dst = new File(state.dataDir.fsName + "/" + rel);
            if (dst.exists) dst.remove();
            new File(stage.fsName + "/" + rel).copy(dst.fsName);
        }
        mFile.copy(state.dataDir.fsName + "/manifest.json");

        var oldTools = new Folder(state.dataDir.fsName + "/tools").getFiles("*.jsx");
        for (i = 0; i < oldTools.length; i++) {
            if (!keep["tools/" + oldTools[i].name]) oldTools[i].remove();
        }

        var from = oldManifest ? oldManifest.version : "?";
        state.reload(); // rebuilds the panel with the new core; old controls are gone
        $.global.MM.api.status("Updated " + from + " -> " + manifest.version);
        if (manifest.changelog) alert("MMScripts " + manifest.version + "\n\n" + manifest.changelog, "MMScripts");
    }

    function openSettings() {
        var s = loadSettings();
        var w = new Window("dialog", "MMScripts Settings");
        w.alignChildren = ["fill", "top"];
        function row(label, value) {
            var g = w.add("group");
            g.add("statictext", undefined, label).preferredSize.width = 70;
            var e = g.add("edittext", undefined, value);
            e.preferredSize.width = 260;
            return e;
        }
        var eRepo = row("Repo", s.repo);
        var eBranch = row("Branch", s.branch);
        var eToken = row("Token", s.token || "");
        var eProxy = row("Proxy", s.proxy || "");
        w.add("statictext", undefined, "Branch HEAD = repo's default branch. Token only for private repos.");
        w.add("statictext", undefined, "Proxy: empty = system proxy, none = direct, or e.g. http://127.0.0.1:10809");
        var btns = w.add("group");
        btns.alignment = "right";
        var reset = btns.add("button", undefined, "Defaults");
        btns.add("button", undefined, "Cancel", { name: "cancel" });
        var ok = btns.add("button", undefined, "Save", { name: "ok" });
        reset.onClick = function () {
            eRepo.text = state.defaults.repo;
            eBranch.text = state.defaults.branch;
            eToken.text = "";
            eProxy.text = "";
        };
        ok.onClick = function () {
            s.repo = eRepo.text.replace(/^\s+|\s+$/g, "");
            s.branch = eBranch.text.replace(/^\s+|\s+$/g, "") || "HEAD";
            s.token = eToken.text.replace(/^\s+|\s+$/g, "");
            s.proxy = eProxy.text.replace(/^\s+|\s+$/g, "");
            saveSettings(s);
            w.close(1);
        };
        w.show();
    }

    // ---------- shared helpers for tools ----------

    function setStatus(msg) {
        if (state.statusText) {
            state.statusText.text = msg;
            try { state.panel.layout.layout(true); } catch (e) {}
        }
    }

    var api = {
        status: setStatus,

        comp: function () {
            var c = app.project.activeItem;
            if (!(c && c instanceof CompItem)) {
                alert("Open a composition first.", "MMScripts");
                return null;
            }
            return c;
        },

        undo: function (name, fn) {
            app.beginUndoGroup(name);
            try {
                return fn();
            } catch (e) {
                alert(name + " failed:\n" + e + (e.line ? "\n(line " + e.line + ")" : ""), "MMScripts");
            } finally {
                app.endUndoGroup();
            }
        },

        util: {}
    };

    // Parent every top-level layer to a temporary null, let `modify(nullLayer)` transform it,
    // then unparent so the change is baked into each layer (keyframes included).
    // opts.skip(layer) -> true to leave a layer alone. Returns { layers, list, expressions }.
    api.util.transformAll = function (comp, opts, modify) {
        opts = opts || {};
        var root = comp.layers.addNull();
        root.name = "MM_TEMP_ROOT";
        root.moveToEnd(); // keep existing layer indices unchanged
        root.transform.position.setValue([comp.width / 2, comp.height / 2]);

        var rootIndex = root.index;
        var children = [], relock = [], exprCount = 0, i, L;
        for (i = 1; i <= comp.numLayers; i++) {
            if (i === rootIndex) continue;
            L = comp.layer(i);
            if (L.parent !== null) continue;
            if (opts.skip && opts.skip(L)) continue;
            if (L.locked) { L.locked = false; relock.push(L); }
            exprCount += countTransformExpressions(L);
            L.parent = root;
            children.push(L);
        }

        modify(root);

        for (i = 0; i < children.length; i++) children[i].parent = null;
        root.remove();
        for (i = 0; i < relock.length; i++) relock[i].locked = true;
        return { layers: children.length, list: children, expressions: exprCount };
    };

    function countTransformExpressions(layer) {
        var n = 0, tr = layer.property("ADBE Transform Group");
        if (!tr) return 0;
        for (var i = 1; i <= tr.numProperties; i++) {
            var p = tr.property(i);
            if (p.canSetExpression && p.expressionEnabled && p.expression !== "") n++;
        }
        return n;
    }

    // Apply fn(value) to a property's static value or to every keyframe.
    // Returns false if the property is driven by an expression (left untouched).
    api.util.mapProperty = function (prop, fn, mapTangent) {
        if (!prop) return true;
        if (prop.canSetExpression && prop.expressionEnabled && prop.expression !== "") return false;
        if (prop.numKeys === 0) {
            prop.setValue(fn(prop.value));
            return true;
        }
        for (var k = 1; k <= prop.numKeys; k++) {
            prop.setValueAtKey(k, fn(prop.keyValue(k)));
            if (mapTangent && prop.isSpatial) {
                prop.setSpatialTangentsAtKey(k, mapTangent(prop.keyInSpatialTangent(k)), mapTangent(prop.keyOutSpatialTangent(k)));
            }
        }
        return true;
    };

    // Move comp guides: fn(orientation, position) -> new position.
    // orientation 0 = horizontal guide (y), 1 = vertical guide (x). Needs AE 16.1+.
    api.util.mapGuides = function (comp, fn) {
        var n = 0;
        try {
            var guides = comp.guides;
            if (!guides) return 0;
            for (var i = 0; i < guides.length; i++) {
                var p = fn(guides[i].orientationType, guides[i].position);
                if (p !== guides[i].position) { comp.setGuide(p, i); n++; }
            }
        } catch (e) {}
        return n;
    };

    // instanceof AVLayer is false for text/shape layers in ExtendScript, so test by exclusion.
    api.util.isCamOrLight = function (L) {
        return (L instanceof CameraLayer) || (L instanceof LightLayer);
    };

    api.util.hasBounds = function (L) {
        return !api.util.isCamOrLight(L) && L.hasVideo;
    };

    // Mirror a layer in place, around the center of its own bounds, along its own x (axis 0)
    // or y (axis 1). Done in layer space (negate scale, mirror anchor), so it holds for
    // every frame and works with parents and keyframes. Returns false if skipped.
    api.util.flipLocal = function (L, axis, time) {
        if (!api.util.hasBounds(L)) return false;
        var tr = L.property("ADBE Transform Group");
        var anchor = tr.property("ADBE Anchor Point"), scale = tr.property("ADBE Scale");
        if ((anchor.expressionEnabled && anchor.expression !== "") ||
            (scale.expressionEnabled && scale.expression !== "")) return false;

        var r = L.sourceRectAtTime(time, L instanceof ShapeLayer);
        var c = axis === 0 ? r.left + r.width / 2 : r.top + r.height / 2;
        var wasLocked = L.locked;
        L.locked = false;
        api.util.mapProperty(anchor,
            function (a) { var n = a.slice(); n[axis] = 2 * c - n[axis]; return n; },
            function (t) { var n = t.slice(); n[axis] = -n[axis]; return n; });
        api.util.mapProperty(scale, function (v) { var n = v.slice(); n[axis] = -n[axis]; return n; });
        L.locked = wasLocked;
        return true;
    };

    // Corner probes: a hidden null with 4 Point Controls whose expressions return
    // a layer's sourceRect corners in comp space (handles parenting, 3D, scale, rotation).
    // Returns { l, t, r, b } in comp pixels. Layers need bounds (see hasBounds).
    api.util.measureBounds = function (comp, layers, wholeDuration) {
        var probe = comp.layers.addNull();
        probe.name = "MM_TEMP_PROBE";
        probe.moveToEnd();
        var fx = probe.property("ADBE Effect Parade");
        var k;
        for (k = 0; k < 4; k++) fx.addProperty("ADBE Point Control");

        var corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
        var box = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
        var fd = comp.frameDuration;

        try {
            for (var i = 0; i < layers.length; i++) {
                var L = layers[i];
                var ext = (L instanceof ShapeLayer) ? "true" : "false";
                var pts = [];
                for (k = 0; k < 4; k++) {
                    var p = fx.property(k + 1).property(1); // re-fetch: adding effects invalidates refs
                    p.expression =
                        "var L = thisComp.layer(" + L.index + ");\n" +
                        "var r = L.sourceRectAtTime(time, " + ext + ");\n" +
                        "var q = L.toComp([r.left + " + corners[k][0] + " * r.width, r.top + " + corners[k][1] + " * r.height]);\n" +
                        "[q[0], q[1]];";
                    if (p.expressionError) throw new Error("Could not measure '" + L.name + "': " + p.expressionError);
                    pts.push(p);
                }

                var times = [];
                if (wholeDuration) {
                    var t0 = Math.max(L.inPoint, 0), t1 = Math.min(L.outPoint, comp.duration);
                    for (var t = t0; t < t1; t += fd) times.push(t);
                    if (!times.length) times.push(comp.time);
                } else {
                    times.push(comp.time);
                }

                for (var ti = 0; ti < times.length; ti++) {
                    for (k = 0; k < 4; k++) {
                        var v = pts[k].valueAtTime(times[ti], false);
                        if (v[0] < box.l) box.l = v[0];
                        if (v[0] > box.r) box.r = v[0];
                        if (v[1] < box.t) box.t = v[1];
                        if (v[1] > box.b) box.b = v[1];
                    }
                }
            }
        } finally {
            probe.remove();
        }
        return box;
    };

    // ---------- UI ----------

    T.boot = function (panel, ctx) {
        state.panel = panel;
        state.dataDir = ctx.dataDir;
        state.defaults = ctx.defaults;
        state.reload = ctx.reload;
        T.tools = [];

        var manifest = localManifest();
        var files = toolFiles(manifest);
        var loadErrors = [];
        for (var i = 0; i < files.length; i++) {
            var f = new File(state.dataDir.fsName + "/" + files[i]);
            if (!f.exists) continue;
            try { $.evalFile(f); } catch (e) { loadErrors.push(files[i] + ": " + e); }
        }

        while (panel.children.length) panel.remove(panel.children[0]);
        panel.orientation = "column";
        panel.alignChildren = ["fill", "top"];
        panel.spacing = 6;
        panel.margins = 8;

        var head = panel.add("group");
        head.alignChildren = ["left", "center"];
        var title = head.add("statictext", undefined, "MMScripts " + (manifest ? "v" + manifest.version : ""));
        title.alignment = ["fill", "center"];
        var bReload = head.add("button", undefined, "Reload");
        var bUpdate = head.add("button", undefined, "Update");
        var bSet = head.add("button", undefined, "...");
        bReload.preferredSize = [58, 22];
        bUpdate.preferredSize = [58, 22];
        bSet.preferredSize = [26, 22];
        bReload.helpTip = "Reload tools from disk (no AE restart).";
        bUpdate.helpTip = "Download the latest tools from GitHub and reload.";
        bSet.helpTip = "Settings: repo, branch, token.";
        bReload.onClick = function () { state.reload(); $.global.MM.api.status("Reloaded."); };
        bUpdate.onClick = update;
        bSet.onClick = openSettings;

        if (!T.tools.length) {
            panel.add("statictext", undefined, "No tools installed yet. Press Update.");
        }

        for (var t = 0; t < T.tools.length; t++) {
            var tool = T.tools[t];
            var box = panel.add("panel", undefined, tool.name);
            box.orientation = "column";
            box.alignChildren = ["fill", "top"];
            box.margins = [8, 14, 8, 8];
            box.spacing = 4;
            try {
                tool.build(box, api);
            } catch (e) {
                box.add("statictext", undefined, "Error: " + e);
            }
        }

        state.statusText = panel.add("statictext", undefined, loadErrors.length ? loadErrors.join(" | ") : "Ready.", { truncate: "end" });
        state.statusText.alignment = ["fill", "bottom"];

        panel.layout.layout(true);
        panel.layout.resize();

        if (!manifest && !T.tools.length) update();
    };

    T.api = api;
    return T;
})();
