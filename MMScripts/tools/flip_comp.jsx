// Flip Comp
// Mirrors everything in the active comp horizontally or vertically around the comp center.
//
// Full flip: layers are parented to a temporary null with -100% scale and unparented again,
// so the mirror is baked into each layer's own transform and keyframes.
//
// Layout only: every layer keeps its look, but its place is mirrored. For each layer:
// position mirrored (about the comp center, or about its parent's center in parent space),
// rotation negated, anchor mirrored about its own center. Scale is untouched. Applied to
// every layer and keyframe, this equals "mirror the comp, then un-mirror each layer".
//
// Cameras and lights can't hold negative scale, so they are mirrored directly. Guides too.

(function () {
    var ROT = ["ADBE Rotate X", "ADBE Rotate Y", "ADBE Rotate Z"];

    // Small helper so hidden properties (e.g. point light orientation) don't abort the run.
    function mapper(api, counter) {
        return function (prop, fn, tan) {
            try {
                if (!api.util.mapProperty(prop, fn, tan)) counter.expr++;
            } catch (e) {}
        };
    }

    function aboutPoint(axis, c) {
        return function (v) { var n = v.slice(); n[axis] = 2 * c - n[axis]; return n; };
    }

    function flipTangent(axis) {
        return function (v) { var n = v.slice(); n[axis] = -n[axis]; return n; };
    }

    function mirrorPosition(tr, axis, c, map) {
        var pos = tr.property("ADBE Position");
        if (pos.dimensionsSeparated) {
            map(tr.property("ADBE Position_" + axis), function (v) { return 2 * c - v; });
        } else {
            map(pos, aboutPoint(axis, c), flipTangent(axis));
        }
    }

    // Mirroring across x negates the Y and Z parts of a rotation; across y, the X and Z parts.
    function mirrorRotation(tr, axis, map) {
        var keep = axis === 0 ? 0 : 1;
        map(tr.property("ADBE Orientation"), function (o) {
            var n = o.slice();
            for (var i = 0; i < 3; i++) if (i !== keep) n[i] = -n[i];
            return n;
        });
        for (var i = 0; i < 3; i++) {
            if (i !== keep) map(tr.property(ROT[i]), function (v) { return -v; });
        }
    }

    function boundsCenter(L, axis, t) {
        var r = L.sourceRectAtTime(t, L instanceof ShapeLayer);
        return axis === 0 ? r.left + r.width / 2 : r.top + r.height / 2;
    }

    function withUnlocked(L, fn) {
        var wasLocked = L.locked;
        L.locked = false;
        fn();
        L.locked = wasLocked;
    }

    function fullFlip(comp, axis, api) {
        var res = api.util.transformAll(comp, { skip: api.util.isCamOrLight }, function (root) {
            var s = root.transform.scale.value.slice();
            s[axis] = -s[axis];
            root.transform.scale.setValue(s);
        });
        return { layers: res.layers, expr: res.expressions, skipped: 0 };
    }

    function layoutFlip(comp, axis, api) {
        var t = comp.time;
        var compCenter = axis === 0 ? comp.width / 2 : comp.height / 2;
        var counter = { expr: 0 }, map = mapper(api, counter);
        var centers = {}, i, L;

        // Measure first: centers are read in each layer's own space, before anything moves.
        for (i = 1; i <= comp.numLayers; i++) {
            L = comp.layer(i);
            if (api.util.hasBounds(L)) centers[i] = boundsCenter(L, axis, t);
        }

        var done = 0, skipped = 0;
        for (i = 1; i <= comp.numLayers; i++) {
            L = comp.layer(i);
            if (centers[i] === undefined) continue; // cameras, lights, audio
            var P = L.parent, c;
            if (P === null) c = compCenter;
            else if (centers[P.index] !== undefined) c = centers[P.index];
            else { skipped++; continue; } // parented to a camera/light

            var own = centers[i];
            withUnlocked(L, function () {
                var tr = L.property("ADBE Transform Group");
                mirrorPosition(tr, axis, c, map);
                mirrorRotation(tr, axis, map);
                map(tr.property("ADBE Anchor Point"), aboutPoint(axis, own), flipTangent(axis));
            });
            done++;
        }
        return { layers: done, expr: counter.expr, skipped: skipped };
    }

    function mirrorCamsAndLights(comp, axis, api) {
        var center = axis === 0 ? comp.width / 2 : comp.height / 2;
        var counter = { expr: 0 }, map = mapper(api, counter), n = 0;
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (!api.util.isCamOrLight(L) || L.parent !== null) continue;
            withUnlocked(L, function () {
                var tr = L.property("ADBE Transform Group");
                mirrorPosition(tr, axis, center, map);
                map(tr.property("ADBE Anchor Point"), aboutPoint(axis, center), flipTangent(axis)); // point of interest
                mirrorRotation(tr, axis, map);
            });
            n++;
        }
        return { count: n, expr: counter.expr };
    }

    function flip(comp, axis, o, api) {
        var res = o.layoutOnly ? layoutFlip(comp, axis, api) : fullFlip(comp, axis, api);
        var cams = o.includeCams ? mirrorCamsAndLights(comp, axis, api) : { count: 0, expr: 0 };
        var guides = 0;
        if (o.guides) {
            // Guide orientation: 0 = horizontal line (a y value), 1 = vertical line (an x value).
            var size = axis === 0 ? comp.width : comp.height;
            guides = api.util.mapGuides(comp, function (orient, p) {
                return (axis === 0) === (orient === 1) ? size - p : p;
            });
        }

        var notes = [];
        if (res.expr + cams.expr) notes.push((res.expr + cams.expr) + " property(ies) are driven by expressions and were not flipped; check them.");
        if (res.skipped) notes.push(res.skipped + " layer(s) parented to a camera/light were left as is.");
        api.status("Flipped " + (axis === 0 ? "horizontally" : "vertically") + ": " + res.layers + " layer(s)" +
            (cams.count ? ", " + cams.count + " camera/light" : "") + (guides ? ", " + guides + " guide(s)" : ""));
        if (notes.length) alert(notes.join("\n\n"), "MMScripts");
    }

    MM.register({
        id: "flip_comp",
        name: "Flip Comp",

        build: function (g, api) {
            var layout = g.add("checkbox", undefined, "Keep objects unmirrored (flip layout only)");
            layout.helpTip = "Positions are mirrored, but each layer keeps its look, so text reads normally.";
            var cams = g.add("checkbox", undefined, "Include cameras & lights");
            cams.value = true;
            var guides = g.add("checkbox", undefined, "Flip guides");
            guides.value = true;

            var row = g.add("group");
            row.alignChildren = ["fill", "center"];
            var bH = row.add("button", undefined, "Flip Horizontal");
            var bV = row.add("button", undefined, "Flip Vertical");
            bH.alignment = bV.alignment = ["fill", "center"];

            function go(axis) {
                var comp = api.comp();
                if (!comp) return;
                api.undo(axis === 0 ? "MM Flip Horizontal" : "MM Flip Vertical", function () {
                    flip(comp, axis, { layoutOnly: layout.value, includeCams: cams.value, guides: guides.value }, api);
                });
            }
            bH.onClick = function () { go(0); };
            bV.onClick = function () { go(1); };
        }
    });
})();
