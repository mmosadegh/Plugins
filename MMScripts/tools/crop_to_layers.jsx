// Crop Comp to Selected Layers
// Resizes the comp to exactly the bounds of the selected layers (at the current frame or
// over their whole duration) and shifts every layer so nothing moves on screen.

(function () {
    function shiftNestedInstances(comp, dx, dy, api) {
        var skipped = 0;
        var users = comp.usedIn;
        for (var c = 0; c < users.length; c++) {
            var pc = users[c];
            for (var i = 1; i <= pc.numLayers; i++) {
                var L = pc.layer(i);
                if (api.util.isCamOrLight(L) || L.source !== comp) continue;
                var wasLocked = L.locked;
                L.locked = false;
                var ok = api.util.mapProperty(L.transform.anchorPoint, function (a) {
                    var n = a.slice();
                    n[0] -= dx;
                    n[1] -= dy;
                    return n;
                });
                if (!ok) skipped++;
                L.locked = wasLocked;
            }
        }
        return skipped;
    }

    function run(comp, api, o) {
        var sel = comp.selectedLayers, layers = [], i;
        for (i = 0; i < sel.length; i++) {
            var L = sel[i];
            if (api.util.hasBounds(L)) layers.push(L); // skips cameras, lights, audio-only
        }
        if (!layers.length) {
            alert("Select one or more visible layers in the comp first.", "MMScripts");
            return;
        }

        api.status("Measuring " + layers.length + " layer(s)...");
        var b = api.util.measureBounds(comp, layers, o.wholeDuration);

        var left = Math.floor(b.l - o.padding);
        var top = Math.floor(b.t - o.padding);
        var w = Math.ceil(b.r + o.padding) - left;
        var h = Math.ceil(b.b + o.padding) - top;
        if (o.even) {
            if (w % 2) w++;
            if (h % 2) h++;
        }
        w = Math.max(4, Math.min(30000, w));
        h = Math.max(4, Math.min(30000, h));

        if (left === 0 && top === 0 && w === comp.width && h === comp.height) {
            api.status("Comp already matches the selection.");
            return;
        }

        var has3D = false;
        for (i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i) instanceof CameraLayer || (comp.layer(i).threeDLayer)) { has3D = true; break; }
        }

        var res = api.util.transformAll(comp, {}, function (root) {
            var p = root.transform.position.value.slice();
            p[0] -= left;
            p[1] -= top;
            root.transform.position.setValue(p);
        });

        var oldW = comp.width, oldH = comp.height;
        comp.width = w;
        comp.height = h;

        api.util.mapGuides(comp, function (orient, p) { return orient === 1 ? p - left : p - top; });

        var skippedNested = o.fixParents ? shiftNestedInstances(comp, left, top, api) : 0;

        var notes = [];
        if (res.expressions) notes.push(res.expressions + " transform expression(s) were not shifted; check them.");
        if (skippedNested) notes.push(skippedNested + " nested instance(s) have an anchor expression and were not compensated.");
        if (has3D) notes.push("Comp has 3D layers/camera: perspective is relative to the new comp center, so 3D may shift slightly.");

        api.status("Cropped " + oldW + "x" + oldH + " -> " + w + "x" + h);
        if (notes.length) alert(notes.join("\n\n"), "MMScripts");
    }

    MM.register({
        id: "crop_to_layers",
        name: "Crop Comp to Selected Layers",

        build: function (g, api) {
            var r1 = g.add("group");
            r1.add("statictext", undefined, "Bounds:");
            var mode = r1.add("dropdownlist", undefined, ["Current frame", "Entire duration"]);
            mode.selection = 0;
            mode.alignment = ["fill", "center"];

            var r2 = g.add("group");
            r2.add("statictext", undefined, "Padding (px):");
            var pad = r2.add("edittext", undefined, "0");
            pad.characters = 5;

            var even = g.add("checkbox", undefined, "Even width/height (for video export)");
            var parents = g.add("checkbox", undefined, "Keep position where comp is nested");
            parents.value = true;
            parents.helpTip = "Shifts the anchor point of this comp's layers in other comps so it doesn't jump.";

            var btn = g.add("button", undefined, "Crop to Selected Layers");
            btn.onClick = function () {
                var comp = api.comp();
                if (!comp) return;
                api.undo("MM Crop Comp to Layers", function () {
                    run(comp, api, {
                        wholeDuration: mode.selection.index === 1,
                        padding: parseFloat(pad.text) || 0,
                        even: even.value,
                        fixParents: parents.value
                    });
                });
            };
        }
    });
})();
