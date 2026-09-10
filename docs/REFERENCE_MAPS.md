# Reference-inspired map choices

Build 112 adds Patchwork Woods, Willow Valley and Broken Ridges. Each family has a 16 × 17 single sheet, a 32 × 17 landscape pair, and a 16 × 34 portrait pair. Portrait deployment uses the north/south ends; other formats use west/east edges. Both human and AI setup menus offer the maps.

The local Flatlands Terrain Set, Hill Terrain Set (map page 3), and Map Set #1 informed the woodland clusters, open lanes, stepped hills and water. These are original, native VTT layouts rather than exact hex transcriptions. The reference PDFs remain local and are not published. Second sheets have different terrain arrangements. Map balance still needs playtesting.

New layouts contain only clear ground, light/heavy woods, rough ground and depth-1 water, with elevations up to 3. No printed mines or smoke. Preview size is capped so portrait maps do not push setup controls far down the page.

Apply SQL/150_initiative_win_report.sql after 149, then SQL/151_reference_inspired_maps.sql before playing the new maps. Existing maps and matches retain their layouts. Migration 151 is generated from buildReferenceMapFamilies in js/game/maps.js with tools/build-reference-map-sql.cjs; regenerate it after changing these definitions before release. The migration preserves existing server functions and adds the new map IDs.

Validation: tools/test-reference-maps.cjs compares every terrain/elevation cell, objectives and deployment against PostgreSQL, checks bounds and rerunning the migration. tools/test-reference-map-ui.cjs checks menu options, bounded previews, portrait deployment and browser errors. Dependencies follow the existing local Playwright/PGlite test setup.
