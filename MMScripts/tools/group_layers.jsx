// Group Layers
// Group: creates a null in the center of the selected layers, parents them to it, and gives
// the null and its layers one label color. Ungroup removes the null and keeps everything
// where it is. Select Members selects everything inside the selected group(s).

(function () {
    var TAG = "MMScripts group";
    var COLORS = ["Red", "Yellow", "Aqua", "Pink", "Lavender", "Peach", "Sea Foam", "Blue",
        "Green", "Purple", "Orange", "Brown", "Fuchsia", "Cyan", "Sandstone", "Dark Green"];
    var AUTO_ORDER = [8, 9, 10, 11, 3, 4, 5, 13, 14, 1, 2, 6, 7, 12, 15, 16];

    function isGroup(L) {
        try { return L.nullLayer && L.comment === TAG; } catch (e) { return false; }
    }

    function autoLabel(comp) {
        var used = {}, n = 0, i;
        for (i = 1; i <= comp.numLayers; i++) {
            if (isGroup(comp.layer(i))) { used[comp.layer(i).label] = true; n++; }
        }
        for (i = 0; i < AUTO_ORDER.length; i++) if (!used[AUTO_ORDER[i]]) return AUTO_ORDER[i];
        return AUTO_ORDER[n % AUTO_ORDER.length];
    }

    function uniqueName(comp, base) {
        var names = {}, i;
        for (i = 1; i <= comp.numLayers; i++) names[comp.layer(i).name] = true;
        if (!names[base]) return base;
        for (i = 2; names[base + " " + i]; i++) {}
        return base + " " + i;
    }

    // Is `L` inside one of the layers whose index is a key of `set` (directly or deeper)?
    function insideAny(L, set) {
        for (var p = L.parent; p !== null; p = p.parent) if (set[p.index]) return true;
        return false;
    }

    function withUnlocked(L, fn) {
        var wasLocked = L.locked;
        L.locked = false;
        fn();
        L.locked = wasLocked;
    }

    function group(comp, o, api) {
        var sel = comp.selectedLayers, i, L;
        if (!sel.length) {
            alert("Select the layers to group first.", "MMScripts");
            return;
        }

        var selIdx = {}, top = sel[0], measurable = [], any3D = false, tIn = Infinity, tOut = -Infinity;
        for (i = 0; i < sel.length; i++) {
            L = sel[i];
            selIdx[L.index] = true;
            if (L.index < top.index) top = L;
            if (api.util.hasBounds(L)) measurable.push(L);
            if (L.threeDLayer) any3D = true;
            if (L.inPoint < tIn) tIn = L.inPoint;
            if (L.outPoint > tOut) tOut = L.outPoint;
        }

        // Only the outermost selected layers get parented; the rest follow their own parent.
        var members = [], outer = {}, outerCount = 0, keepParent = null;
        for (i = 0; i < sel.length; i++) {
            L = sel[i];
            if (insideAny(L, selIdx)) continue;
            members.push(L);
            var key = L.parent === null ? 0 : L.parent.index;
            if (!outer[key]) { outer[key] = true; outerCount++; keepParent = L.parent; }
        }

        var center;
        if (measurable.length) {
            var b = api.util.measureBounds(comp, measurable, false);
            center = [(b.l + b.r) / 2, (b.t + b.b) / 2];
        } else {
            center = [comp.width / 2, comp.height / 2];
        }

        var label = o.label || autoLabel(comp);
        var g = comp.layers.addNull();
        g.name = uniqueName(comp, o.name || "Group");
        try { g.comment = TAG; } catch (e) {}
        g.label = label;
        if (any3D) g.threeDLayer = true;
        var p = g.transform.position.value.slice();
        p[0] = center[0];
        p[1] = center[1];
        g.transform.position.setValue(p);
        g.moveBefore(top);
        if (tIn < tOut) {
            g.inPoint = tIn;
            g.outPoint = tOut;
        }

        // All members share one outside parent: put the group under it so the rig keeps working.
        var skipped = 0;
        if (outerCount === 1 && keepParent !== null) g.parent = keepParent;
        for (i = 0; i < members.length; i++) {
            L = members[i];
            if (outerCount > 1 && L.parent !== null) { skipped++; continue; }
            withUnlocked(L, function () { L.parent = g; });
        }

        if (o.colorLayers) {
            var gi = {};
            gi[g.index] = true;
            for (i = 1; i <= comp.numLayers; i++) {
                L = comp.layer(i);
                if (insideAny(L, gi)) withUnlocked(L, function () { L.label = label; });
            }
        }

        for (i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        g.selected = true;

        api.status("Grouped " + (members.length - skipped) + " layer(s) into '" + g.name + "'");
        if (skipped) {
            alert(skipped + " layer(s) already have different parents and were left out of the group.", "MMScripts");
        }
    }

    function selectedGroups(comp) {
        var out = [], sel = comp.selectedLayers;
        for (var i = 0; i < sel.length; i++) if (isGroup(sel[i]) || sel[i].nullLayer) out.push(sel[i]);
        return out;
    }

    function ungroup(comp, api) {
        var groups = selectedGroups(comp);
        if (!groups.length) {
            alert("Select a group null first.", "MMScripts");
            return;
        }
        var n = 0;
        for (var k = 0; k < groups.length; k++) {
            var g = groups[k], up = g.parent, gIdx = g.index;
            for (var i = 1; i <= comp.numLayers; i++) {
                var L = comp.layer(i);
                if (L.parent === null || L.parent.index !== gIdx) continue;
                withUnlocked(L, function () { L.parent = up; });
                n++;
            }
            g.locked = false;
            g.remove();
        }
        api.status("Ungrouped " + n + " layer(s)");
    }

    function selectMembers(comp, api) {
        var groups = selectedGroups(comp);
        if (!groups.length) {
            alert("Select a group null first.", "MMScripts");
            return;
        }
        var set = {}, i, n = 0;
        for (i = 0; i < groups.length; i++) set[groups[i].index] = true;
        for (i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            L.selected = insideAny(L, set);
            if (L.selected) n++;
        }
        api.status("Selected " + n + " layer(s)");
    }

    MM.register({
        id: "group_layers",
        name: "Group Layers",

        build: function (g, api) {
            var r1 = g.add("group");
            r1.add("statictext", undefined, "Name:");
            var name = r1.add("edittext", undefined, "Group");
            name.characters = 10;
            r1.add("statictext", undefined, "Color:");
            var color = r1.add("dropdownlist", undefined, ["Auto"].concat(COLORS));
            color.selection = 0;
            color.helpTip = "Auto picks a label color no other group in this comp uses.";

            var colorLayers = g.add("checkbox", undefined, "Give the layers the group's color");
            colorLayers.value = true;

            var row = g.add("group");
            row.alignChildren = ["fill", "center"];
            var bGroup = row.add("button", undefined, "Group");
            var bUngroup = row.add("button", undefined, "Ungroup");
            var bSelect = row.add("button", undefined, "Select Members");
            bGroup.alignment = bUngroup.alignment = bSelect.alignment = ["fill", "center"];
            bUngroup.helpTip = "Removes the selected group null; layers stay where they are.";
            bSelect.helpTip = "Selects every layer inside the selected group(s).";

            bGroup.onClick = function () {
                var comp = api.comp();
                if (!comp) return;
                api.undo("MM Group Layers", function () {
                    group(comp, {
                        name: name.text.replace(/^\s+|\s+$/g, ""),
                        label: color.selection.index, // 0 = auto, otherwise AE label 1-16
                        colorLayers: colorLayers.value
                    }, api);
                });
            };
            bUngroup.onClick = function () {
                var comp = api.comp();
                if (comp) api.undo("MM Ungroup", function () { ungroup(comp, api); });
            };
            bSelect.onClick = function () {
                var comp = api.comp();
                if (comp) selectMembers(comp, api);
            };
        }
    });
})();
