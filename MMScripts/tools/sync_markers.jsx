// Sync Precomp Markers
// Copies the comp markers inside each precomp onto that precomp's layer in the active comp,
// at the matching time (layer start time and time stretch are taken into account).
// Copied markers are tagged, so running it again replaces them with the current ones and
// leaves markers you added by hand alone.

(function () {
    var TAG = "mm_sync";

    function isTagged(mv) {
        try { return mv.getParameters()[TAG] === "1"; } catch (e) { return false; }
    }

    function copyMarker(src, stretch) {
        var mv = new MarkerValue(src.comment);
        mv.duration = src.duration * stretch;
        mv.chapter = src.chapter;
        mv.url = src.url;
        mv.frameTarget = src.frameTarget;
        mv.cuePointName = src.cuePointName;
        mv.eventCuePoint = src.eventCuePoint;
        try { mv.label = src.label; } catch (e) {}            // AE 2022+
        var params = {};
        try { params = src.getParameters(); } catch (e) {}
        params[TAG] = "1";
        mv.setParameters(params);
        return mv;
    }

    function removeSynced(L) {
        var m = L.property("ADBE Marker"), n = 0;
        for (var k = m.numKeys; k >= 1; k--) {
            if (isTagged(m.keyValue(k))) { m.removeKey(k); n++; }
        }
        return n;
    }

    function precompLayers(comp, selectedOnly) {
        var src = selectedOnly ? comp.selectedLayers : [], out = [], i;
        if (!selectedOnly) for (i = 1; i <= comp.numLayers; i++) src.push(comp.layer(i));
        for (i = 0; i < src.length; i++) {
            if (src[i].source instanceof CompItem) out.push(src[i]);
        }
        return out;
    }

    function sync(comp, selectedOnly, api) {
        var layers = precompLayers(comp, selectedOnly);
        if (!layers.length) {
            alert(selectedOnly ? "Select one or more precomp layers first." : "This comp has no precomp layers.", "MMScripts");
            return;
        }
        var added = 0, touched = 0, remapped = 0;
        for (var i = 0; i < layers.length; i++) {
            var L = layers[i], srcMarkers = L.source.markerProperty;
            var wasLocked = L.locked;
            L.locked = false;
            var removed = removeSynced(L);
            var stretch = L.stretch / 100;
            if (L.timeRemapEnabled && srcMarkers.numKeys) remapped++;
            var lm = L.property("ADBE Marker");
            for (var k = 1; k <= srcMarkers.numKeys; k++) {
                var t = L.startTime + srcMarkers.keyTime(k) * stretch;
                lm.setValueAtTime(t, copyMarker(srcMarkers.keyValue(k), Math.abs(stretch)));
                added++;
            }
            if (removed || srcMarkers.numKeys) touched++;
            L.locked = wasLocked;
        }
        api.status("Synced " + added + " marker(s) on " + touched + " precomp layer(s)");
        if (remapped) {
            alert(remapped + " layer(s) use time remapping: markers are placed as if there were no remap.", "MMScripts");
        }
    }

    function clear(comp, selectedOnly, api) {
        var layers = precompLayers(comp, selectedOnly), n = 0;
        for (var i = 0; i < layers.length; i++) {
            var wasLocked = layers[i].locked;
            layers[i].locked = false;
            n += removeSynced(layers[i]);
            layers[i].locked = wasLocked;
        }
        api.status("Removed " + n + " synced marker(s)");
    }

    MM.register({
        id: "sync_markers",
        name: "Sync Precomp Markers",

        build: function (g, api) {
            var scope = g.add("dropdownlist", undefined, ["All precomp layers in this comp", "Selected layers only"]);
            scope.selection = 0;
            scope.alignment = ["fill", "center"];

            var row = g.add("group");
            row.alignChildren = ["fill", "center"];
            var bSync = row.add("button", undefined, "Sync Markers");
            var bClear = row.add("button", undefined, "Remove Synced");
            bSync.alignment = bClear.alignment = ["fill", "center"];
            bSync.helpTip = "Copy each precomp's comp markers onto its layer. Run again to update.";
            bClear.helpTip = "Remove only the markers this tool added.";

            bSync.onClick = function () {
                var comp = api.comp();
                if (comp) api.undo("MM Sync Precomp Markers", function () { sync(comp, scope.selection.index === 1, api); });
            };
            bClear.onClick = function () {
                var comp = api.comp();
                if (comp) api.undo("MM Remove Synced Markers", function () { clear(comp, scope.selection.index === 1, api); });
            };
        }
    });
})();
