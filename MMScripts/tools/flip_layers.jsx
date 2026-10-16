// Flip Selected Layers
// Mirrors each selected layer in place, around the center of its own bounds, along the
// layer's own axes. Keyframes, parenting and motion are kept.

(function () {
    function flipSelected(comp, axis, api) {
        var sel = comp.selectedLayers, done = 0, skipped = 0;
        for (var i = 0; i < sel.length; i++) {
            if (!api.util.hasBounds(sel[i])) continue;
            if (api.util.flipLocal(sel[i], axis, comp.time)) done++;
            else skipped++;
        }
        if (!done && !skipped) {
            alert("Select one or more layers first.", "MMScripts");
            return;
        }
        api.status("Flipped " + done + " layer(s) " + (axis === 0 ? "horizontally" : "vertically"));
        if (skipped) alert(skipped + " layer(s) have anchor/scale expressions and were not flipped.", "MMScripts");
    }

    MM.register({
        id: "flip_layers",
        name: "Flip Selected Layers",

        build: function (g, api) {
            var row = g.add("group");
            row.alignChildren = ["fill", "center"];
            var bH = row.add("button", undefined, "Flip Horizontal");
            var bV = row.add("button", undefined, "Flip Vertical");
            bH.alignment = bV.alignment = ["fill", "center"];

            function go(axis) {
                var comp = api.comp();
                if (!comp) return;
                api.undo(axis === 0 ? "MM Flip Layers Horizontal" : "MM Flip Layers Vertical", function () {
                    flipSelected(comp, axis, api);
                });
            }
            bH.onClick = function () { go(0); };
            bV.onClick = function () { go(1); };
        }
    });
})();
