// Flip Comp
// Mirrors everything in the active comp horizontally or vertically around the comp center.
// Layers are parented to a temporary null with -100% scale and unparented again, so the
// flip is baked into each layer's own transform and keyframes. Cameras and lights can't
// hold negative scale, so their position/point of interest/rotation are mirrored directly.

(function () {
    // axis 0 = horizontal (mirror x), 1 = vertical (mirror y)
    function mirrorCamOrLight(L, axis, center, api) {
        var ok = true, tr = L.property("ADBE Transform Group");
        var flipPoint = function (v) { var n = v.slice(); n[axis] = 2 * center - n[axis]; return n; };
        var flipTangent = function (v) { var n = v.slice(); n[axis] = -n[axis]; return n; };
        var negate = function (v) { return -v; };
        // Some properties are hidden on certain cameras/lights (e.g. point light orientation).
        var map = function (prop, fn, tan) {
            try { if (!api.util.mapProperty(prop, fn, tan)) ok = false; } catch (e) {}
        };

        var pos = tr.property("ADBE Position");
        if (pos.dimensionsSeparated) {
            map(tr.property("ADBE Position_" + axis), function (v) { return 2 * center - v; });
        } else {
            map(pos, flipPoint, flipTangent);
        }
        map(tr.property("ADBE Anchor Point"), flipPoint, flipTangent); // point of interest

        // Mirroring a rotation across the x axis negates its Y and Z parts; across y, X and Z.
        var keep = axis === 0 ? 0 : 1;
        map(tr.property("ADBE Orientation"), function (o) {
            var n = o.slice();
            for (var i = 0; i < 3; i++) if (i !== keep) n[i] = -n[i];
            return n;
        });
        var names = ["ADBE Rotate X", "ADBE Rotate Y", "ADBE Rotate Z"];
        for (var i = 0; i < 3; i++) {
            if (i !== keep) map(tr.property(names[i]), negate);
        }
        return ok;
    }

    function flip(comp, axis, includeCams, keepObjects, api) {
        var res = api.util.transformAll(comp, { skip: api.util.isCamOrLight }, function (root) {
            var s = root.transform.scale.value.slice();
            s[axis] = -s[axis];
            root.transform.scale.setValue(s);
        });

        // Layout-only: un-mirror each flipped layer in place (children follow their parent).
        var notReflipped = 0;
        if (keepObjects) {
            for (var j = 0; j < res.list.length; j++) {
                if (!api.util.hasBounds(res.list[j])) continue;
                if (!api.util.flipLocal(res.list[j], axis, comp.time)) notReflipped++;
            }
        }

        var camCount = 0, camSkipped = 0;
        if (includeCams) {
            var center = axis === 0 ? comp.width / 2 : comp.height / 2;
            for (var i = 1; i <= comp.numLayers; i++) {
                var L = comp.layer(i);
                if (!api.util.isCamOrLight(L) || L.parent !== null) continue;
                var wasLocked = L.locked;
                L.locked = false;
                if (!mirrorCamOrLight(L, axis, center, api)) camSkipped++;
                L.locked = wasLocked;
                camCount++;
            }
        }

        var notes = [];
        if (res.expressions) notes.push(res.expressions + " transform expression(s) were not flipped; check them.");
        if (notReflipped) notes.push(notReflipped + " layer(s) have anchor/scale expressions and stay mirrored.");
        if (camSkipped) notes.push(camSkipped + " camera/light property(ies) have expressions and were not flipped.");
        api.status("Flipped " + (axis === 0 ? "horizontally" : "vertically") + ": " +
            res.layers + " layer(s)" + (camCount ? ", " + camCount + " camera/light" : ""));
        if (notes.length) alert(notes.join("\n\n"), "MMScripts");
    }

    MM.register({
        id: "flip_comp",
        name: "Flip Comp",

        build: function (g, api) {
            var cams = g.add("checkbox", undefined, "Include cameras & lights");
            cams.value = true;
            var keep = g.add("checkbox", undefined, "Keep objects unmirrored (flip layout only)");
            keep.helpTip = "Positions are mirrored, but each layer is flipped back so text and objects read normally.";

            var row = g.add("group");
            row.alignChildren = ["fill", "center"];
            var bH = row.add("button", undefined, "Flip Horizontal");
            var bV = row.add("button", undefined, "Flip Vertical");
            bH.alignment = bV.alignment = ["fill", "center"];

            function go(axis) {
                var comp = api.comp();
                if (!comp) return;
                api.undo(axis === 0 ? "MM Flip Horizontal" : "MM Flip Vertical", function () {
                    flip(comp, axis, cams.value, keep.value, api);
                });
            }
            bH.onClick = function () { go(0); };
            bV.onClick = function () { go(1); };
        }
    });
})();
