"use strict";

// Don't roll your own CSV parser, kids.
import * as papa from "papaparse";

// Courseware objects (Teaching Elements and containers) are
// JSON objects that can have a variety of structures.
export interface CourseObject {
  [key: string]: any;
}

/**
 * Makes a string that holds a CSV spreadsheet of the course's contents,
 * in order from beginning to end, with some extra detail about certain items.
 * @param json_files
 * @returns A CSV spreadsheet showing the course's contents
 */
export async function createCourseSheet(
  json_files: {
    name: string;
    data: any[];
  }[]
): Promise<string> {
  // The flattened course is an array of objects with strings as keys.
  // We'll convert this to a CSV string.
  // Include typescript types.
  let flat_course: CourseObject[] = [];
  let course_csv_array: { [key: string]: string }[] = [];
  let course_csv_string = "";
  let last_te_name = "";
  let row_template: { [key: string]: string } = {
    te_type: "",
    te_name: "",
    duration: "(not a video)",
    filename: "n/a",
    te_content_sample: "",
  };

  let current_section_container = 0;
  let activities = json_files.filter((e) => e.name.includes("activities"))[0];
  let elements = json_files.filter((e) => e.name.includes("elements"))[0];
  flat_course = getCoursewareInOrder(activities.data, elements.data);
  console.debug(flat_course);

  // Because everything is in order, we can get locations by just walking the list.
  let location = {
    module: "",
    folder: "",
    page: "",
    section: "",
    leaf_container: "",
  };

  flat_course.forEach((c) => {
    let name = getCoursewareName(c);
    // console.debug(name);
    let temp_row = { ...row_template };
    if ("parent_id" in c) {
      // If it has a parent_id, it's an activity (a container).
      if (c.type.includes("PAGE") && c.parent_id === null) {
        location.module = "(top level)";
        location.page = name;
        current_section_container = 0;
      } else if (c.parent_id === null) {
        // Null parent ID means it's a top-level container.
        location.module = name;
        current_section_container = 0;
      } else if (c.type.includes("FOLDER")) {
        location.folder = name;
        current_section_container = 0;
      } else if (c.type.includes("PAGE")) {
        location.page = name;
        current_section_container = 0;
      } else if (c.type.includes("SECTION_CONTAINER")) {
        current_section_container += 1;
      } else if (c.type.includes("SECTION")) {
        location.section = name;
      } else if (
        c.type.includes("INVISIBLE") ||
        c.type.includes("QUESTION_SET") ||
        c.type.includes("EXPAND_CONTAINER")
      ) {
        location.leaf_container = name;
      }
    } else {
      // If it doesn't have a parent_id, it's an element (a TE).
      temp_row.te_type = c.type;
      temp_row.te_name = name;
      temp_row.te_content_sample = getContentSample(c);
      if (c.type.includes("VIDEO")) {
        temp_row.duration = secToHMS(c.data.duration);
        temp_row.filename = c.data.assetFilename;
      }
      if (c.type.includes("IMAGE")) {
        if("assets" in c.data && "url" in c.data.assets) {
          temp_row.filename = c.data.assets.url
            .split("___")
            .pop()
            .split("/")
            .pop()
          }
      }
    }

    // Be explicit about when it's blank so we don't think it's a mistake.
    if (temp_row.te_content_sample === "") {
      temp_row.te_content_sample = "(blank)";
    }

    // If it's the exact same name, assume it's a duplicate and skip it.
    // Otherwise, push a merge of the location and row to the CSV array.
    if (temp_row.te_name != last_te_name) {
      course_csv_array.push({ ...location, ...temp_row });
      last_te_name = temp_row.te_name;
    }
  });

  // List only TEs - don't bother with empty containers.
  course_csv_array = course_csv_array.filter((s) => s.te_name != "");

  course_csv_string = papa.unparse(course_csv_array);
  console.debug("CSV string created.");
  // console.debug(course_csv_string);

  return course_csv_string;
}

/**
 * Sorts the courseware in the order in which it appears in the course.
 * Includes both the elements.json and activities.json files.
 *
 * @param activities The activities.json file
 * @param elements The elements.json file
 * @returns One big array of the courseware, in order
 */
export function getCoursewareInOrder(
  activities: CourseObject[],
  elements: CourseObject[]
): CourseObject[] {
  console.debug("Getting courseware in order");

  let count = 1;
  let top_level_folders: CourseObject[] = [];
  let courseware_in_order: CourseObject[] = [];
  for (let a of activities) {
    if (a.parent_id === null && a.deleted_at === null) {
      top_level_folders.push(a);
    }
  }
  let sorted_top_level_folders = top_level_folders.sort(
    (a, b) => a.position - b.position
  );
  // console.debug(sorted_top_level_folders);
  // Dive down into the course to get bottom-level TEs.
  // TODO: I think I might be assuming that there are TEs in every folder. Check on that.
  for (let folder of sorted_top_level_folders) {
    let result = recursiveDig(activities, elements, folder, [], count);
    courseware_in_order.push(...result[0]);
    count = result[1];
  }

  console.log("Courseware put in order.");
  return courseware_in_order;
}

function recursiveDig(
  activities: CourseObject[],
  elements: CourseObject[],
  container: CourseObject,
  all_courseware: CourseObject[] = [],
  count = 0,
  padding = ""
): [CourseObject[], number] {
  // Make sure we have the current container
  all_courseware.push(container);

  // If the activitity is a bottom-level folder, send us to the TE sorting function.
  let leaf_containers = [
    "INVISIBLE_CONTAINER",
    "EXPAND_CONTAINER",
    "CEK_QUESTION_SET",
  ];
  if (leaf_containers.includes(container["type"])) {
    let result = putTesInOrder(elements, container, count);
    all_courseware.push(...result[0]);
    count = result[1];
    return [all_courseware, count];
  }

  // Otherwise, keep recursing.
  // Get the children of the current folder.
  let children = activities.filter((a) => a["parent_id"] == container["id"]);
  // Sort the children by position.
  let sorted_children = children.sort((a, b) => a["position"] - b["position"]);

  for (let child of sorted_children) {
    // console.log(padding + getCoursewareName(child));
    count++;
    let result = recursiveDig(
      activities,
      elements,
      child,
      all_courseware,
      count,
      padding + "  "
    );
    all_courseware = result[0];
    count = result[1];
  }
  return [all_courseware, count];
}

/**
 * Gets the name of a courseware item (TE or container).
 * This is obnoxious because different courseware objects store the name in different places,
 * and we also have to get fallbacks in case things don't exist.
 * @param courseware A courseware object
 * @returns Something that's our best guess for the name of the courseware item.
 */
function getCoursewareName(courseware: CourseObject): string {
  if (courseware.display_name) {
    if (courseware.display_name === "") {
      return "Nameless " + courseware.type + " " + courseware.id;
    } else {
      return courseware.display_name;
    }
  }

  if (courseware.type === "INVISIBLE_CONTAINER") {
    return "(invisible container) " + courseware.id;
  } else if (courseware.type === "EXPAND_CONTAINER") {
    return "(expand container) " + courseware.id;
  } else if (courseware.type === "CEK_QUESTION_SET") {
    return "(question set) " + courseware.id;
  } else if (courseware.type === "SECTION_CONTAINER") {
    return "(section container) " + courseware.id;
  } else if (courseware.type === "SECTION") {
    try {
      if (courseware.data.title === "") {
        return "Nameless SECTION " + courseware.id;
      }
      return courseware.data.title;
    } catch (TypeError) {
      return "Nameless SECTION " + courseware.id;
    }
  } else {
    // We've run through container options; now let's check for TE types.
    let temp_name = "Nameless " + courseware.type + " " + courseware.id;
    try {
      if (courseware.data.name) {
        return courseware.data.name.trim();
      }
    } catch (TypeError) {
      /*Do nothing*/
    }
    try {
      if (courseware.data.title) {
        return courseware.data.title.trim();
      }
    } catch (TypeError) {
      /*Do nothing*/
    }
    try {
      if (courseware.meta.title) {
        return courseware.meta.title.trim();
      }
    } catch (TypeError) {
      /*Do nothing*/
    }
    // Somehow we got here without finding any reasonable name.
    return temp_name;
  }
}

/**
 * Returns a sample of the text in a course element, 100 characters or less.
 * Every TE stores its data a different way, so we have to check for each type.
 * @param te A courseware object, specifically a Teaching Element
 * @returns A string
 */
function getContentSample(te: CourseObject): string {
  let te_content_sample = "";
  if (te.type.includes("HTML")) {
    te_content_sample = te.data.content;
  } else if (te.type.includes("REFLECTION") || te.type.includes("POLL")) {
    te_content_sample = te.data.prompt.content;
  } else if (te.type.includes("QUESTION") && !te.type.includes("SET")) {
    te_content_sample = te.data.question;
  } else if (te.type.includes("IMAGE")) {
    if (te.meta.alt) {
      te_content_sample = "Alt text: " + te.meta.alt;
    } else {
      te_content_sample = "Alt text: " + te.data.alt;
    }
  } else if (te.type.includes("PDF")) {
    te_content_sample = "PDF - no title given";
    if ("url" in te.data.assets) {
      // Normally a long random string, ___, and the filename.
      if (te.data.assets.url != "") {
        te_content_sample = "PDF: " + te.data.assets.url.split("___").splice(1,).join();
        if (te_content_sample === "") {
          te_content_sample = te.data.assets.url;
        }
      }
    }
  } else if (te.type.includes("CDA_VIDEO")) {
    te_content_sample = "Video - no title given";
    // TODO: Pull the content sample from the transcript or captions.
    if ("title" in te.meta) {
      if (te.meta.title != "") {
        te_content_sample = "Video: " + te.meta.title;
      }
    }
    if ("assetFilename" in te.data) {
      if (te.data.assetFilename != "") {
        te_content_sample = "Video: " + te.data.assetFilename;
      }
    }
  } else if (te.type.includes("LXP_RATING_SCALE")) {
    te_content_sample = te.data.inputData.prompt;
  } else {
    te_content_sample = "(no sample available)";
  }
  // Don't keep ridiculously long samples.
  if (te_content_sample.length > 100) {
    te_content_sample = te_content_sample.slice(0, 100) + "...";
  }

  return te_content_sample;
}

/**
 * Sorts the TEs in a container by position.
 * @param elements The entire elements.json file (not just the ones we're sorting)
 * @param container The container whose TEs we're sorting
 * @param count
 * @returns
 */
function putTesInOrder(
  elements: CourseObject[],
  container: CourseObject,
  count: number
): [CourseObject[], number] {
  let elements_in_container = elements.filter(
    (e) => e["activity_id"] == container["id"]
  );
  let te_list = elements_in_container.sort(
    (a, b) => a["position"] - b["position"]
  );
  count += te_list.length;
  return [te_list, count];
}

// Pulls the course name from the repo data and cleans it up for use as a filename.
export function getCourseName(repo_data: object): string {
  if ("name" in repo_data) {
    let temp_name = String(repo_data.name);
    // Replace non-ascii characters and ascii but non-printable characters
    temp_name = temp_name.replace(/[^\x20-\x7E]/g, "_");
    // Replace spaces, slashes, and other characters that don't work well in filenames.
    // Currently: * / \ : " ' < > | ? ^ % ! @ # $ & + = ` ~ [ ] { } ( ) ; , and whitespace
    temp_name = temp_name
      .replace(/[\/\\:"'<>|?*^%!@#$&+=`~\[\]{}();,\s]/g, "_")
      .trim();
    return temp_name;
  } else {
    return "processed_course";
  }
}

// Turns seconds into hours:minutes:seconds
function secToHMS(seconds: number): string {
  let hours = Math.floor(seconds / 3600);
  let hour_string = String(hours);
  let minutes = Math.floor((seconds % 3600) / 60);
  let min_string = String(minutes);
  let sec = Math.floor(seconds % 60);
  let sec_string = String(sec);
  if (minutes < 10) {
    min_string = "0" + String(minutes);
  }
  if (sec < 10) {
    sec_string = "0" + String(sec);
  }
  return hour_string + ":" + min_string + ":" + sec_string;
}
