"use strict";

import { v4 as uuidv4 } from "uuid";
import { updateStatus } from "./index";
import { CourseObject, getCoursewareInOrder } from "./course_sheet";
import { bottom } from "@popperjs/core";

// Doing this as an array of arrays to allow multiple items at the same level.
const activity_hierarchy = [
  ["LONG_HLXP_SCHEMA/FOLDER"],
  ["LONG_HLXP_SCHEMA/PAGE"],
  ["SECTION_CONTAINER"],
  ["SECTION"],
  ["INVISIBLE_CONTAINER", "CEK_QUESTION_SET", "EXPAND_CONTAINER"],
];

/**
 * Handles all locking/unlocking and required/optional settings.
 * Passes sectioning off to another function.
 *
 * @param json_files
 * @param options taken from the form
 * @returns the revised JSON files
 */
export async function processSections(
  json_files: { name: string; data: any[] }[],
  options: {
    lock_unlock: string;
    required_optional: string;
    section_scope: string;
    clean: boolean;
    spreadsheet: boolean;
    video_credits: boolean;
    video_intro: boolean;
  }
): Promise<{ name: string; data: any[] }[]> {
  let activities = json_files.filter((e) => e.name.includes("activities"))[0].data;
  await updateStatus("Processing sections");

  // In every "SECTION" activity, apply or remove both lock and "completion required".
  // We're smashing whatever is there now.
  for (let activity of activities) {
    if (activity.type === "SECTION") {
      if (options.lock_unlock === "lock") {
        activity.data.locked = true;
      } else if (options.lock_unlock === "unlock") {
        activity.data.locked = false;
      }
      if (options.required_optional === "require") {
        activity.data.completionRequired = true;
      } else if (options.required_optional === "optional") {
        activity.data.completionRequired = false;
      }
    }
  }

  // Update the json files with the new activities.
  json_files.forEach((f) => {
    if (f.name.includes("activities")) {
      f.data = activities;
    }
  });

  if (options.section_scope !== "no_change") {
    json_files = await setSectionGrain(json_files, options);
  }

  if (options.video_credits || options.video_intro) {
    json_files = await heuristicSectioning(json_files, options.video_credits, options.video_intro);
  }

  // Send back the updated json files
  return json_files;
}

export async function processQuestionSets(
  json_files: { name: string; data: any[] }[],
  options: {
    pass_percent: number;
    num_attempts: number;
    show_answers: string;
    show_feedback: string;
    qset_display: string;
  }
): Promise<{ name: string; data: any[] }[]> {
  let activities = json_files.filter((e) => e.name.includes("activities"))[0];
  let question_sets = activities.data.filter(
    (a) => a.type === "CEK_QUESTION_SET" && !a.detached && !a.deleted_at
  );

  // When do we show the answers?
  if (options.show_answers === "answers_when_submitted") {
    question_sets.forEach(function (qset, i) {
      qset.data.displayCorrectAnswers = "onSubmit";
    });
  }
  if (options.show_answers === "answers_after_attempts") {
    question_sets.forEach(function (qset, i) {
      qset.data.displayCorrectAnswers = "onAllowExhaust";
    });
  }
  if (options.show_answers === "answers_never") {
    question_sets.forEach(function (qset, i) {
      qset.data.displayCorrectAnswers = "never";
    });
  }

  // When do we show the feedback?
  if (options.show_feedback === "feedback_when_submitted") {
    question_sets.forEach(function (qset, i) {
      qset.data.displayFeedback = "onSubmit";
    });
  }
  if (options.show_feedback === "feedback_after_attempts") {
    question_sets.forEach(function (qset, i) {
      qset.data.displayFeedback = "onAllowExhaust";
    });
  }
  if (options.show_feedback === "feedback_never") {
    question_sets.forEach(function (qset, i) {
      qset.data.displayFeedback = "never";
    });
  }

  // Display one question at a time or all of them?
  if (options.qset_display === "display_one") {
    question_sets.forEach(function (qset, i) {
      qset.data.displayQuestions = "one";
    });
  }
  if (options.qset_display === "display_all") {
    question_sets.forEach(function (qset, i) {
      qset.data.displayQuestions = "all";
    });
  }

  // Are we changing the number of attemtps and passing percentage?
  if (options.num_attempts > 0) {
    question_sets.forEach(function (qset, i) {
      qset.data.numberOfAttempts = options.num_attempts;
    });
  }
  if (options.pass_percent > 0) {
    question_sets.forEach(function (qset, i) {
      qset.data.minimumPassingPercentage = options.pass_percent;
    });
  }

  // Write the fixed question sets back to the activities variable.
  question_sets.forEach(function (qset, i) {
    let index = activities.data.findIndex((a) => a.id === qset.id);
    activities.data[index] = qset;
  });

  return json_files;
}

/**
 * Splits a course up into sections, either putting each TE in its own section
 * or putting all TEs on a single page into a single section.
 *
 * @param json_files
 * @param section_scope
 * @returns
 */
async function setSectionGrain(
  json_files: { name: string; data: any[] }[],
  options: {
    lock_unlock: string;
    required_optional: string;
    section_scope: string;
    clean: boolean;
    spreadsheet: boolean;
    video_credits: boolean;
    video_intro: boolean;
  }
): Promise<{ name: string; data: any[] }[]> {
  //  Notes:
  //   - Every TE already has its own individual Invisible, so we can work with those
  //     instead of having to work with actual TEs.
  //   - Don't double-wrap singleton TEs in multiple Invisibles by accident.
  //   - Relevant Structure: Page --> Section Container --> Section(s) --> Invisible(s)
  //   - Skip detached activities.

  console.debug("Section scope: " + options.section_scope);

  let activities = json_files.filter((e) => e.name.includes("activities"))[0].data;
  let elements = json_files.filter((e) => e.name.includes("elements"))[0].data;

  let repo_id = activities[0]["repository_id"];
  let current_id = 1000000000000000; // Just picking something arbitrarily high to avoid collisions with existing materials.

  let pages = activities.filter(function (a) {
    return a.type === "LONG_HLXP_SCHEMA/PAGE" && !a.detached && !a.deleted_at;
  });

  pages.forEach(function (p) {
    // Get all the section containers for this page and sort them by position.
    let section_containers = activities.filter((a) => a.parent_id == p.id);
    section_containers = section_containers.sort(function (a, b) {
      return a.position - b.position;
    });
    let section_container_ids = section_containers.map((sc) => sc.id);

    // Get all the sections for this page.
    let sections = activities.filter(function (a) {
      return section_container_ids.includes(a.parent_id) && !a.detached && !a.deleted_at;
    });
    // Temporarily attach the position of the section container to each section.
    sections.forEach(function (s) {
      s.sc_position = section_containers.find((sc) => sc.id == s.parent_id).position;
    });
    // No need to sort these; they're all getting thrown out anyway.
    let section_ids = sections.map((s) => s.id);

    // Get all the invisibles for this page and sort them by position.
    let invisibles = activities.filter(function (a) {
      return section_ids.includes(a.parent_id) && !a.detached && !a.deleted_at;
    });
    // Add the position of the section container and the section to each invisible.
    invisibles.forEach(function (i) {
      i.sc_position = sections.find((s) => s.id == i.parent_id).sc_position;
      i.section_position = sections.find((s) => s.id == i.parent_id).position;
    });
    // Sort by own position and then by parent's position and then grandparents'.
    invisibles = invisibles.sort(function (a, b) {
      return (
        a.position - b.position ||
        a.section_position - b.section_position ||
        a.sc_position - b.sc_position
      );
    });

    // Update the positions of the invisibles. This should put them in order down the page.
    invisibles.forEach(function (inv, index) {
      inv.position = index + 1;
    });

    // Create one and only one new section container for each page
    activities.push({
      id: current_id,
      repository_id: repo_id,
      parent_id: p.id,
      uid: makeUUID(),
      type: "SECTION_CONTAINER",
      position: 1,
      data: {},
      refs: {},
      detached: false,
      published_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      modified_at: null,
    });

    let sc_id = current_id;
    current_id += 1;

    if (options.section_scope === "section_per_te") {
      // Each invisible is getting its own section.
      // console.debug("Sectioning by TE");
      invisibles.forEach(function (i) {
        activities.push({
          id: current_id,
          repository_id: repo_id,
          parent_id: sc_id,
          uid: makeUUID(),
          type: "SECTION",
          position: i.position,
          data: {
            title: "",
            description: "",
            completionRequired: options.required_optional === "require",
            locked: options.lock_unlock === "lock",
          },
          refs: {},
          detached: false,
          published_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
          modified_at: null,
        });

        // Move the invisible into the new section.
        // Position value should already be in the right order (and doesn't need to start at 1.)
        i.parent_id = current_id;
        i.updated_at = new Date().toISOString();
        i.modified_at = new Date().toISOString();
        i.deleted_at = null;

        current_id += 1;
      });
    } else if (options.section_scope === "section_per_page") {
      // Create one section for each section container on the page.
      console.debug("Sectioning by page");
      let one_section = {
        id: current_id,
        repository_id: repo_id,
        parent_id: sc_id,
        uid: makeUUID(),
        type: "SECTION",
        position: 1,
        data: {
          title: p.data.title,
          description: "",
          completionRequired: options.required_optional === "require",
          locked: options.lock_unlock === "lock",
        },
        refs: {},
        detached: false,
        published_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
        modified_at: null,
      };
      // All invisibles on this page go into that section container.
      invisibles.forEach(function (i) {
        i.parent_id = one_section.id;
      });
      activities.push(one_section);
      current_id += 1;
    }

    // Now that we're done with all invisibles in this page,
    // detach the previous set of section containers and sections.
    section_containers.forEach(function (sc) {
      sc.detached = true;
      sc.deleted_at = new Date().toISOString();
      sc.modified_at = new Date().toISOString();
      sc.updated_at = new Date().toISOString();
    });

    sections.forEach(function (s) {
      s.detached = true;
      s.deleted_at = new Date().toISOString();
      s.modified_at = new Date().toISOString();
      s.updated_at = new Date().toISOString();
    });
  });

  // Clear out temporary position values.
  for (let act of activities) {
    try {
      delete act.sc_position;
    } catch (e) { }
    try {
      delete act.section_position;
    } catch (e) { }
  }

  let all_element_parents = elements.map((e) => e.activity_id);

  // Keep only INVISIBLE_CONTAINERs that have child elements.
  // (Don't touch other things at the Invisible level, like Expandables.)
  let empty_invisible_ids = activities
    .filter(function (a) {
      return a.type === "INVISIBLE_CONTAINER" && !all_element_parents.includes(a.id);
    })
    .map((a) => a.id);
  let non_empty_activities = activities.filter(function (a) {
    return !empty_invisible_ids.includes(a.id);
  });

  // Write non-empty activities back to the activities data.
  json_files.forEach((f) => {
    if (f.name.includes("activities")) {
      f.data = non_empty_activities;
    }
  });

  let cleaned_course = await cleanCourse(json_files);
  console.debug(cleaned_course);
  return cleaned_course;
}

/**
 * Uses rule-of-thumb to collect certain items together,
 * such as putting video intros and credits in the same section as the video.
 *
 * @param json_files
 * @param video_credits
 * @param video_intro
 * @returns the revised JSON files
 */
async function heuristicSectioning(
  json_files: { name: string; data: any[] }[],
  video_credits: boolean,
  video_intro: boolean
): Promise<{ name: string; data: any[] }[]> {
  let activities = json_files.filter((e) => e.name.includes("activities"))[0].data;
  let elements = json_files.filter((e) => e.name.includes("elements"))[0].data;

  console.debug("video credits: " + video_credits + ", video intro: " + video_intro);

  // Start by making a nicer structure to work with.
  // This will be an array of copies of section containers, each with
  // `contents` arrays that contain copies of sections, and so on down to TEs.
  let outline = getNestedStructure(getCoursewareInOrder(activities, elements));

  // Now that we have the nice happy data structure, we can work with it much easier.
  // Go through sections, batched by section container so we don't accidentally leave the page.
  for (let q = 0; q < outline.length; q++) {
    let local_sections = outline[q].contents;
    for (let i = 0; i < local_sections.length; i++) {
      let local_invisibles = local_sections[i].contents;
      // Is there just one invisible (or equivalent) in this section?
      if (local_invisibles.length !== 1) {
        continue;
      }
      // Is there just one TE in this invisible?
      if (local_invisibles[0].contents.length !== 1) {
        continue;
      }
      // Is it a video TE?
      let local_te = local_invisibles[0].contents[0];
      if (!local_te.type.includes("VIDEO")) {
        continue;
      }
      // The positions of the invisibles here will be 1,2,3, just to make it simple.
      // Write that to the activities array.
      let target = activities.find((a) => a.id === local_invisibles[0].id);
      target.position = 2;

      if (video_intro) {
        // Is there a previous section?
        if (i !== 0) {
          let previous_section = local_sections[i - 1];
          // Is it just one invisible with one HTML TE?
          if (previous_section.contents.length === 1) {
            let previous_invis = previous_section.contents[0];
            if (
              previous_invis.contents.length === 1 &&
              previous_invis.type.includes("INVISIBLE_CONTAINER")
            ) {
              let previous_te = previous_invis.contents[0];
              if (previous_te.type.includes("HTML")) {
                // Move the invisible for the HTML TE out of the previous section and into the current one.
                // Remember to do this in the non_empty_activities array, because that's our current working item
                // that we're going to write back to the json_files later.
                let target = activities.find((a) => a.id === previous_invis.id);
                target.parent_id = local_sections[i].id;
                target.position = 1;
                previous_section.contents = [];
                local_sections[i].contents.unshift(previous_invis);
              }
            }
          }
        }
      }
      if (video_credits) {
        // Is there a next section?
        if (i !== local_sections.length - 1) {
          let next_section = local_sections[i + 1];
          // Is it just one expandable with one HTML TE?
          if (next_section.contents.length === 1) {
            let next_invis = next_section.contents[0];
            if (next_invis.contents.length === 1 && next_invis.type.includes("EXPAND_CONTAINER")) {
              let next_te = next_invis.contents[0];
              if (next_te.type.includes("HTML")) {
                // Move the Expandable container out of the next section and into the current one.
                // We need to do this in the non_empty_activities array, because that's our current working item
                // that we're going to write back to the json_files later.
                let target = activities.find((a) => a.id === next_invis.id);
                target.parent_id = local_sections[i].id;
                target.position = 3;
                next_section.contents = [];
                local_sections[i].contents.push(next_invis);
              }
            }
          }
        }
      }
    }
  }

  // Write the changes back to the activities array.
  json_files.forEach((f) => {
    if (f.name.includes("activities")) {
      f.data = activities;
    }
  });

  return json_files;
}

/**
 * Takes in a flat array of courseware items and returns a nested structure.
 * The courseware must be in the order that it appears in the course,
 * or you're going to get things in the wrong order on the way out.
 * @param courseware_in_order
 * @returns
 */
function getNestedStructure(courseware_in_order: CourseObject[]): CourseObject[] {
  let section_containers = courseware_in_order.filter((a) => a.type === "SECTION_CONTAINER");
  let sections = courseware_in_order.filter((a) => a.type === "SECTION");
  let all_section_ids = sections.map((s) => s.id);
  let invisibles_and_friends = courseware_in_order.filter(function (a) {
    // Rather than trying to enumerate all the kinds of invisible-level containers,
    // which we might have more of over time,
    // we're just going to check to see if its parent is a section.
    return all_section_ids.includes(a.parent_id);
  });
  // Only TEs have activity id values. Activities instead have parent_id.
  let tes = courseware_in_order.filter((e) => e.hasOwnProperty("activity_id"));

  console.log(section_containers);
  console.log(sections);
  console.log(invisibles_and_friends);
  console.log(tes);

  let outline = structuredClone(section_containers);
  // Let's put copies of each courseware item into a nested data structure.
  for (let i = 0; i < outline.length; i++) {
    // Start by getting the sections that are the child of this section container.
    let local_sections = [];
    for (let j = 0; j < sections.length; j++) {
      if (sections[j].parent_id === outline[i].id) {
        local_sections.push(structuredClone(sections[j]));
      }
    }
    // Attach that to the section container as its "contents"
    outline[i].contents = local_sections;
    // Now go down to the sections and get the invisibles (or equivalent) in each section.
    for (let k = 0; k < local_sections.length; k++) {
      let local_invis = [];
      for (let l = 0; l < invisibles_and_friends.length; l++) {
        if (invisibles_and_friends[l].parent_id === local_sections[k].id) {
          local_invis.push(structuredClone(invisibles_and_friends[l]));
        }
      }
      // Attach that to the section as its "contents"
      local_sections[k].contents = local_invis;
      // Final stage: teaching elements.
      for (let m = 0; m < local_invis.length; m++) {
        let local_tes = [];
        for (let n = 0; n < tes.length; n++) {
          if (tes[n].activity_id === local_invis[m].id) {
            local_tes.push(structuredClone(tes[n]));
          }
        }
        // Attach that to the invisible as its "contents"
        local_invis[m].contents = local_tes;
      }
    }
  }
  return outline;
}

/**
 * Makes it so you can't fast-forward through videos.
 * (or if "scrub" is false, makes it so you can)
 * @param json_files
 * @param scrub
 * @returns
 */
export function disableVideoScrubbing(
  json_files: {
    name: string;
    data: any[];
  }[],
  scrub = true
): { name: string; data: any[] }[] {
  // If we're locking and requiring the course, let's make every video "cannot skip ahead".
  let elements = json_files.filter((e) => e.name.includes("element"))[0];
  elements.data.forEach((e) => {
    if (e.type === "VIDEO") {
      e.data.disableScrubbing = scrub;
      if (scrub) {
        e.data.completionPercentage = 95; // Allows for a ~10 second bumper on a 3 minute video.
      }
    }
  });

  return json_files;
}

/**
 * Removes some specific items from the courseware:
 *  - Elements linked to elements that don't exist.
 *  - Elements and activities without parents.
 *  - Elements that are output_only and detached.
 * @param json_files A dictionary of the course's JSON files
 * @returns The course's JSON files
 */
export async function cleanCourse(
  json_files: {
    name: string;
    data: any[];
  }[]
): Promise<
  {
    name: string;
    data: any[];
  }[]
> {
  let activities = json_files.filter((e) => e.name.includes("activities"))[0].data;
  let elements = json_files.filter((e) => e.name.includes("elements"))[0].data;
  await updateStatus("Cleaning course");

  // Ok, let's try this the simple way.
  // I tried to be picky and careful about it and it didn't work,
  // so now I'm just going to throw out the course history during the cleaning process.
  // If it's detached (i.e. not in the course), vaporize it.
  activities = activities.filter((a) => !a.detached);
  elements = elements.filter((e) => !e.detached);
  // If it's an empty bottom-level container or section, vaporize it.
  let bottom_levels = activity_hierarchy.slice(-1)[0];
  let bottom_level_kids_shown = activities
    .filter(function (a) {
      return bottom_levels.includes(a.type);
    })
    .map(function (a) {
      return {
        id: a.id,
        kids: elements.filter((e) => e.activity_id === a.id),
      };
    });
  let childless_activities = bottom_level_kids_shown.filter(function (a) {
    return a.kids.length === 0;
  });
  activities = activities.filter(function (a) {
    return !childless_activities.map((a) => a.id).includes(a.id);
  });

  // Make a list of childless sections and remove them.
  let sections_kids_shown = activities
    .filter((a) => a.type === "SECTION")
    .map(function (a) {
      return {
        id: a.id,
        kids: activities.filter((b) => b.parent_id === a.id).map((c) => c.id),
      };
    });
  console.debug("Sections, with kids shown: ", sections_kids_shown);
  let childless_sections = sections_kids_shown.filter(function (a) {
    return a.kids.length === 0;
  });
  activities = activities.filter(function (a) {
    return !childless_sections.map((a) => a.id).includes(a.id);
  });
  // Childless section containers and higher levels are fine.

  // Remove any elements whose parent doesn't exist.
  let activity_ids = activities.map((a) => a.id);
  elements = elements.filter(function (e) {
    return activity_ids.includes(e.activity_id);
  });

  // Write the cleaned-up data back to the json_files.
  json_files.forEach((f) => {
    if (f.name.includes("activities")) {
      f.data = activities;
    }
    if (f.name.includes("elements")) {
      f.data = elements;
    }
  });

  return json_files;
}

/////////////////////////////////////////
// Utilities
/////////////////////////////////////////

// Separate function just in case I need to change it later.
export function makeUUID(): string {
  return uuidv4();
}
