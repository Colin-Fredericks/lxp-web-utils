"use strict";

// Start with flattened course sheet or the course CSV
// Make an entry in a CSV for each link in each TE
//   If it's an HTML or Advanced HTML TE inside an Expandable, skip it
//   Otherwise, get every link in the TE and make a row for it
//   Include iframes and any hotlinked images
// Pass back to main javascript


//   flat_course.forEach((c) => {
//     let temp_row = { ...row_template };
//     if ("parent_id" in c) {
//       // If it has a parent_id, it's an activity (a container).
//       if (c.type.includes("PAGE") && c.parent_id === null) {
//         location.module = "(top level)";
//         location.page = name;
//         current_section_container = 0;
//       } else if (c.parent_id === null) {
//         // Null parent ID means it's a top-level container.
//         location.module = name;
//         current_section_container = 0;
//       } else if (c.type.includes("FOLDER")) {
//         location.folder = name;
//         current_section_container = 0;
//       } else if (c.type.includes("PAGE")) {
//         location.page = name;
//         current_section_container = 0;
//       } else if (c.type.includes("SECTION_CONTAINER")) {
//         current_section_container += 1;
//       } else if (c.type.includes("SECTION")) {
//         location.section = name;
//       } else if (
//         c.type.includes("INVISIBLE") ||
//         c.type.includes("QUESTION_SET") ||
//         c.type.includes("EXPAND_CONTAINER")
//       ) {
//         location.leaf_container = name;
//       }
//     } else {
//       // If it doesn't have a parent_id, it's an element (a TE).
//       temp_row.te_type = c.type;
//       temp_row.te_name = name;
//       temp_row.te_input_output = getInputOutput(c);
//       temp_row.te_content_sample = getContentSample(c);
//       if (c.type.includes("VIDEO")) {
//         temp_row.duration = secToHMS(c.data.duration);
//         temp_row.filename = c.data.assetFilename;
//       }
//       if (c.type.includes("IMAGE")) {
//         if (typeof c.data.assets !== "undefined") {
//           if ("url" in c.data.assets) {
//             temp_row.filename = c.data.assets.url.split("___").pop().split("/").pop();
//           }
//         }
//       }
//     }

//     // Be explicit about when it's blank so we don't think it's a mistake.
//     if (temp_row.te_content_sample === "") {
//       temp_row.te_content_sample = "(blank)";
//     }

//     // If it's the exact same name, assume it's a duplicate and skip it.
//     // Otherwise, push a merge of the location and row to the CSV array.
//     if (temp_row.te_name != last_te_name) {
//       course_csv_array.push({ ...location, ...temp_row });
//       last_te_name = temp_row.te_name;
//     }
//   });
