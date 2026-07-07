"use strict";

import * as papa from "papaparse";
import { CourseObject } from "./course_sheet";

export async function createLinkSheet(
  json_files: {
    name: string;
    data: any[];
  }[],
  course_sheet: string,
): Promise<string> {
  console.log("Creating link sheet");

  let link_array: CourseObject[] = [];
  let link_sheet = "";
  let elements = json_files.find((f) => f.name === "elements.json")?.data;
  if (!elements) {
    let err = "elements.json not found in json_files";
    console.error(err);
    return err;
  }

  let course_csv = papa.parse(course_sheet, { header: true }).data;
  let csv_array = Array.from(course_csv) as CourseObject[];

  // For each TE:
  csv_array.forEach((row) => {
    // If it's inside an Expandable with "credits" in the name, skip it
    let parent = row.leaf_container;
    if (parent && parent.toLowerCase().includes("credits")) {
      return;
    }
    // Otherwise, make a copy of the row to be added into the new CSV. 
    let new_row = { ...row };
    let te = getElementById(elements, row.te_id);
    if (!te) {
      return;
    }
    let html = getHTML(te);
    if (!html) {
      return;
    }
    let document = new DOMParser().parseFromString(html, "text/html");

    // Then for every link in that TE (including iframes):
    let links = Array.from(document.querySelectorAll("a, iframe"));
    links.forEach((link) => {
      let href = link.getAttribute("href") || link.getAttribute("src");
      // Skip mailto or anchor links
      if (!href) {
        return;
      }
      // Dupe a row for it
      // Insert the link info into that row
      let link_text = link.textContent || "";
      let link_row = { ...new_row };
      link_row.link_text = link_text;
      link_row.link_url = href;
      link_array.push(link_row);
    });

  });

  // Stringify the CSV
  link_sheet = papa.unparse(link_array, { header: true });
  // Pass back to main javascript
  return link_sheet;
}

/**
 * Fetches the data for a TE by its numerical id
 * (not the uuid or any other IDs)
 * @param elements 
 * @param id 
 * @returns the Element in question
 */
function getElementById(elements: any[], id: string | number): CourseObject | null {
  try {
    id = Number(id);
  } catch (e) {
    console.error(`Error converting id ${id} to number: ${e}`);
    return null;
  }

  let element = elements.find((e) => e.id === id);
  if (!element) {
    let err = `Element with id ${id} not found in elements.json`;
    console.error(err);
    return null;
  }
  return element;
}

/**
 * The HTML content of a TE can be stored in a lot of places.
 * This concatenates them all into one string and handles
 * any sort of TE.
 * @param te The Element in question
 * @returns The HTML as a string
 */
function getHTML(te: CourseObject): string {
  let html = "";
  switch (te.type) {
    case "HLXP_HTML":
      html = te.data?.rte?.content || "";
      break;
    case "LXP_JODIT_HTML":
      html = te.data?.content || "";
      break;
    case "LXP_ADV_HTML":
      html = te.data?.html?.codeContent || "";
      break;
    case "LXP_CATEGORIZATION":
    case "LXP_WORD_CLOUD":
      html = te.data?.prompt || "";
      break;
    case "LXP_RANKING":
    case "HLXP_REFLECTION":
      html = te.data?.prompt?.content || "";
      break;
    case "LXP_FREE_ENTRY_TABLE":
    case "LXP_LIST":
    case "LXP_RATING_SCALE":
      html = te.data?.inputData?.prompt || "";
      break;
    case "HLXP_POLL":
      html = te.data?.prompt?.content || "";
      // Poll responses can be HTML
      te.data.responses.forEach((response: any) => {
        html += response.content || "";
      });
      break;
    // QUESTIONS
    case "LXP_NUMERIC":
      html = te.data?.prompt?.content || "";
      html += te.data?.feedback?.content || "";
      break;
    case "HLXP_SINGLE_CHOICE_QUESTION":
      html = te.data?.question?.content || "";
      te.data.answers.forEach((answer: any) => {
        html += answer.content || "";
      });
      for (let x in te.data?.feedback) {
        html += te.data?.feedback[x]?.content || "";
      }
      html += te.data?.generalFeedback?.content || "";
      break;
    case "HLXP_MULTIPLE_CHOICE_QUESTION":
      html = te.data?.question?.content || "";
      te.data.answers.forEach((answer: any) => {
        html += answer.content || "";
      });
      for (let x in te.data?.targetedFeedback) {
        html += te.data?.targetedFeedback[x]?.content || "";
      }
      html += te.data?.feedback?.content || "";
      break;
    case "HLXP_MATCHING_QUESTION":
      html = te.data?.question?.content || "";
      html += te.data?.feedback?.content || "";
      break;
    default:
      html = "";
      console.warn(`TE type ${te.type} not recognized. No HTML content extracted.`);
      break;
  }
  return html;
}