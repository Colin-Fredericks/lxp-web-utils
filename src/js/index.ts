console.debug("javscript loaded");

import { createCourseSheet, getCourseName } from "./course_sheet";
import {
  processSections,
  disableVideoScrubbing,
  processQuestionSets,
  cleanCourse,
} from "./batch_ops";
import { Archive } from "@obsidize/tar-browserify";
import { gzip, ungzip } from "pako";
import "bootstrap";
import "bootstrap/dist/css/bootstrap.min.css";
import "../css/index.css";

/////////////////////////////////////////
// Package setup:
// This file handles all the user interaction.
// course_sheet.ts handles creating the CSV.
// batch_ops.ts handles the actual course manipulation.
/////////////////////////////////////////

// TODO list:
// Handle INVISIBLE_CONTAINERs better in sectioning.
// Present numerical options better in updateConfirmationDialog(), especially -1
// Report what's been cleaned in cleanCourse()
// Replace removed items with placeholders in cleanCourse()
// Improve the code for heuristic sectioning, maybe with a try/catch block
// When we get LTI tools, add extra info from them to the spreadsheet

const default_settings: { [key: string]: boolean | number } = {
  clean: true,
  display_all: false,
  display_no_change: true,
  display_one: false,
  just_spreadsheet: false,
  just_test: false,
  keep_locking: true,
  keep_req: true,
  keep_scrub: true,
  keep_sectioning: true,
  lock: false,
  no_scrub: false,
  num_attempts_no_change: true,
  num_attempts: -1,
  optional: false,
  pass_percent_no_change: true,
  pass_percent: -1,
  require: false,
  scrub_ok: false,
  section_per_page: false,
  section_per_te: false,
  show_no_change: true,
  spreadsheet: true,
  unlock: false,
  video_credits: true,
  video_intro: true,
};

const human_readable_options: { [key: string]: string } = {
  clean: "Clean course",
  download_new_course: "Output a new course",
  lock_unlock: "Locking",
  required_optional: "Requirement",
  scrubbing: "Scrubbing",
  section_scope: "Sectioning",
  qset_display: "Question display",
  num_attempts: "Number of attempts",
  pass_percent: "Passing percentage",
  show_answers: "Show answers",
  show_feedback: "Show feedback",
  spreadsheet: "Include course spreadsheet",
  test: "Testing only",
};

const human_readable_details: { [key: string]: object } = {
  clean: {
    true: "Cleaning course for import.",
    false: "Not cleaning the course.",
  },
  download_new_course: {
    true: "Yes.",
    false: "No.",
  },
  lock_unlock: {
    lock: "Locking entire course.",
    unlock: "Unlocking entire course.",
    no_change: "No change.",
  },
  num_attempts: {
    special: "handle in updateConfirmationDialog()",
  },
  num_attempts_no_change: {
    true: "No change.",
    false: "Setting number of attempts. ",
  },
  pass_percent: {
    special: "handle in updateConfirmationDialog()",
  },
  pass_percent_no_change: {
    true: "No change.",
    false: "Setting passing percentage.",
  },
  qset_display: {
    display_one: "Displaying one question at a time.",
    display_all: "Displaying all questions at once.",
    display_no_change: "No change.",
  },
  required_optional: {
    require: "Requiring all sections.",
    optional: "Making all sections optional.",
    no_change: "No change.",
  },
  scrubbing: {
    disable: "Disabling video scrubbing.",
    enable: "Enabling video scrubbing.",
    no_change: "No change.",
  },
  section_scope: {
    section_per_te: "One section per TE.",
    section_per_page: "One section per page.",
    no_change: "No change.",
  },
  show_answers: {
    answers_when_submitted: "Showing answers on submission.",
    answers_after_attempts: "Showing answers after all attempts.",
    answers_never: "Never showing answers.",
    answers_no_change: "No change.",
  },
  show_feedback: {
    feedback_when_submitted: "Showing answers on submission.",
    feedback_after_attempts: "Showing answers after all attempts.",
    feedback_never: "Never showing answers.",
    feedback_no_change: "No change.",
  },
  spreadsheet: {
    true: "Yes.",
    false: "No.",
  },
  test: {
    true: "Yes.",
    false: "No.",
  },
  video_credits: {
    true: "Moving post-video Expand containers.",
    false: "Not moving post-video Expand containers",
  },
  video_intro: {
    true: "Moving pre-video HTML TEs.",
    false: "Not moving pre-video HTML TEs.",
  },
};

const progress_stage: { [key: string]: number } = {
  Starting: 0,
  "Getting options": 5,
  "Loading file": 10,
  "Expanding file": 20,
  "Extracting data": 30,
  "Parsing JSON": 55,
  "Processing sections": 60,
  "Cleaning course": 65,
  "Assembling files": 70,
  "Writing file": 75,
  Download: 100,
};

/**
 * This is our "main" function.
 * Waits until the page loads to run, clears some interface elements,
 * then sets up listeners for the file input and go button.
 */
document.addEventListener("DOMContentLoaded", () => {
  console.debug("DOM loaded");

  updateStatus("Starting");
  makeConfirmationDialog();
  resetSettings();
  addListeners(); // <-- flow passes to the go button from here
  updateOptionSummary();
});

/**
 * Explicitly reset some of the interface in case the user reloads.
 */
function resetSettings(): void {
  for (let option in default_settings) {
    let element = document.getElementById(option) as HTMLInputElement;
    if (element) {
      if (element.type === "checkbox" || element.type === "radio") {
        element.checked = !!default_settings[option];
      } else if (element.type === "number" && typeof default_settings[option] === "number") {
        if (default_settings[option] >= 0) {
          element.value = String(default_settings[option]);
        } else {
          element.value = "";
        }
      } else {
        console.debug("Could not find element with id=", option);
      }
    }
  }
}

/**
 * Puts listeners on the file input, form elements, and go button.
 * Application flow starts at the go button.
 */
function addListeners(): void {
  let input_file: File;
  const go_button = document.getElementById("go");
  const form_controls = document.querySelectorAll("input, select");
  const file_input_element = document.getElementById("input_tarball") as HTMLInputElement;

  if (!go_button || !form_controls || !file_input_element) {
    console.error("Missing some basic HTML - check the index.html file");
    return;
  }
  file_input_element.value = "";

  // Any time a form control is changed, update the settings summaries
  form_controls.forEach((e) => {
    e.addEventListener("change", () => {
      updateOptionSummary();
    });
  });

  // When we have a file, enable the go button
  file_input_element.addEventListener("change", (event) => {
    input_file = getInputFile(event);
    go_button.removeAttribute("disabled");
  });

  // When they glick the go button, flow passes to the confirmation dialog
  go_button.addEventListener("click", () => {
    console.debug("Go button clicked");
    if (!input_file) {
      console.error("No file uploaded");
    } else {
      updateConfirmationDialog(input_file);
    }
  });
}

/**
 * Gets the file from the input element
 *
 * @param event The event that triggered this function
 * @returns The file supplied by the user
 */
function getInputFile(event: Event): File {
  const elem = event.target as HTMLInputElement;
  if (!elem.files) {
    console.error("Could not find the file");
    return new File([], "");
  }
  if (elem.files.length === 0) {
    console.error("No file uploaded");
    return new File([], "");
  }
  console.debug(elem.files[0].name);
  console.debug(elem.files[0].constructor.name);
  return elem.files[0];
}

/**
 * Reads the form to get options for how to handle the course.
 * The options object looks like this:\
 * { \
 *  clean: boolean,\
 *  download_new_course: boolean,\
 *  just_test_value: boolean,\
 *  lock_unlock: "lock" | "unlock" | "no_change",\
 *  num_attempts: number,\
 *  num_attempts_no_change: boolean,\
 *  pass_percent: number,\
 *  pass_percent_no_change: boolean,\
 *  qset_display: "display_one" | "display_all" | "no_change",\
 *  required_optional: "require" | "optional" | "no_change",\
 *  scrubbing: "disable" | "enable" | "no_change",\
 *  section_scope: "section_per_te" | "section_per_page" | "no_change",\
 *  show_answers: "answers_when_submitted" | "answers_after_attempts" | "answers_never" | "answers_no_change",\
 *  show_feedback: "feedback_when_submitted" | "feedback_after_attempts" | "feedback_never" | "feedback_no_change",\
 *  spreadsheet: boolean (are we making a spreadsheet) \
 *  video_credits: boolean (are we moving post-video Expand containers) \
 *  video_intro: boolean (are we moving pre-video HTML TEs) \
 * }
 *
 * @returns The options from the form
 */
function getOptions(): {
  clean: boolean;
  download_new_course: boolean;
  just_test_value: boolean;
  lock_unlock: string;
  num_attempts: number;
  num_attempts_no_change: boolean;
  pass_percent: number;
  pass_percent_no_change: boolean;
  qset_display: string;
  required_optional: string;
  scrubbing: string;
  section_scope: string;
  show_answers: string;
  show_feedback: string;
  spreadsheet: boolean;
  test: boolean;
  video_credits: boolean;
  video_intro: boolean;
} {
  let download_new_course = true;
  let just_test_value = false;

  // Get the options from the lock_unlock radio buttons
  let lock_unlock = document.querySelector('input[name="lock_unlock"]:checked') as HTMLInputElement;
  let lock_unlock_value = lock_unlock.value;

  // Get the options from the required_optional radio buttons
  let required_optional = document.querySelector(
    'input[name="req_opt"]:checked'
  ) as HTMLInputElement;
  let required_optional_value = required_optional.value;

  // Can learners scrub through videos?
  let scrubbing = document.querySelector('input[name="scrubbing"]:checked') as HTMLInputElement;
  let scrubbing_value = scrubbing.value;

  // Are we sectioning by TE, by page, or no change?
  let section_scope = document.querySelector(
    'input[name="sectioning"]:checked'
  ) as HTMLInputElement;
  let section_scope_value = section_scope.value;

  // Are we doing some heuristics to try to get video
  // intros and credits next to the video?
  let video_intro = document.getElementById("video_intro") as HTMLInputElement;
  let video_intro_value = video_intro.checked;
  let video_credits = document.getElementById("video_credits") as HTMLInputElement;
  let video_credits_value = video_credits.checked;

  // How many attempts are allowed?
  let qset_display = document.querySelector(
    'input[name="qset_display"]:checked'
  ) as HTMLInputElement;
  let qset_display_value = qset_display.value;

  // What's the minimum passing percentage?
  let pass_percent_no_change = true;
  let pass_percent = document.getElementById("pass_percent") as HTMLInputElement;
  let pass_percent_temp = pass_percent.value;
  let pass_percent_value = -1; // Default: No passing percentage required.
  // Strip out % signs
  if (pass_percent_temp.endsWith("%")) {
    pass_percent_temp = pass_percent_temp.slice(0, -1);
  }
  pass_percent_value = Number(pass_percent_temp);
  if (isNaN(pass_percent_value) || pass_percent_temp === "") {
    // We've been passed a non-numeric value, so treat it as "no change"
    pass_percent_value = -1;
  } else {
    pass_percent_no_change = false;
  }

  // How many attempts are allowed?
  let num_attempts_no_change = true;
  let num_attempts = document.getElementById("num_attempts") as HTMLInputElement;
  let num_attempts_value = Number(num_attempts.value);
  // If we're passed any non-blank string, treat it as "no change"
  if (isNaN(num_attempts_value) || num_attempts.value === "") {
    num_attempts_value = -1;
  } else {
    num_attempts_no_change = false;
  }

  // When should we show the answers?
  let show_answers = document.querySelector(
    'input[name="show_answers"]:checked'
  ) as HTMLInputElement;
  let show_answers_value = show_answers.value;

  // When should we show the feedback?
  let show_feedback = document.querySelector(
    'input[name="show_feedback"]:checked'
  ) as HTMLInputElement;
  let show_feedback_value = show_feedback.value;

  // Get the clean checkbox
  let clean = document.getElementById("clean") as HTMLInputElement;
  let clean_value = clean.checked;

  // Include course spreadsheet?
  let include_course_spreadsheet = document.getElementById("spreadsheet") as HTMLInputElement;
  let include_course_spreadsheet_value = include_course_spreadsheet.checked;

  // Sometimes you just want the course spreadsheet and not to do any operations on it.
  let just_spreadsheet = document.getElementById("just_spreadsheet") as HTMLInputElement;
  let just_test = document.getElementById("just_test") as HTMLInputElement;
  if (just_spreadsheet.checked || just_test.checked) {
    clean_value = false;
    download_new_course = false;
    just_test_value = just_test.checked;
    lock_unlock_value = "no_change";
    num_attempts_value = -1;
    num_attempts_no_change = true;
    pass_percent_value = -1;
    pass_percent_no_change = true;
    qset_display_value = "no_change";
    required_optional_value = "no_change";
    scrubbing_value = "no_change";
    section_scope_value = "no_change";
    show_answers_value = "no_change";
    show_feedback_value = "feedback_no_change";
    include_course_spreadsheet_value = true;
    video_credits_value = false;
    video_intro_value = false;
  }

  let options = {
    clean: clean_value,
    download_new_course: download_new_course,
    just_test_value: just_test.checked,
    lock_unlock: lock_unlock_value,
    num_attempts: num_attempts_value,
    num_attempts_no_change: num_attempts_no_change,
    pass_percent: pass_percent_value,
    pass_percent_no_change: pass_percent_no_change,
    qset_display: qset_display_value,
    required_optional: required_optional_value,
    scrubbing: scrubbing_value,
    section_scope: section_scope_value,
    show_answers: show_answers_value,
    show_feedback: show_feedback_value,
    spreadsheet: include_course_spreadsheet_value,
    test: just_test_value,
    video_credits: video_credits_value,
    video_intro: video_intro_value,
  };
  return options;
}

/**
 * Updates the summary of options based on the form
 *
 * @returns
 */
function updateOptionSummary(): void {
  let options = getOptions();
  let access_span = document.getElementById("access-details");
  let section_span = document.getElementById("section-details");
  let qset_span = document.getElementById("qset-details");
  let output_span = document.getElementById("output-details");
  let obsolete_access_span = document.getElementById("obsolete-access-details");
  if (!access_span || !section_span || !output_span || !qset_span || !obsolete_access_span) {
    console.error("Could not find one of the details spans");
    return;
  }

  // Clear the existing set of summaries.
  access_span.textContent = "";
  section_span.textContent = "";
  output_span.textContent = "";
  qset_span.textContent = "";

  // Locking row
  let access_options = "Scrubbing: ";
  if (options.scrubbing === "disable") {
    access_options += "<span class='changed-setting'>disable</span>";
  } else if (options.scrubbing === "enable") {
    access_options += "<span class='changed-setting'>enable</span>";
  } else {
    access_options += "no change";
  }
  access_span.innerHTML = access_options;

  // Scope row
  let section_options = "Scope: ";
  if (options.section_scope === "section_per_te") {
    section_options += "<span class='changed-setting'>one section per TE</span>, ";
  } else if (options.section_scope === "section_per_page") {
    section_options += "<span class='changed-setting'>one section per page</span>, ";
  } else {
    section_options += "no change";
  }
  section_options += ", Heuristics: ";
  if (options.video_intro) {
    section_options += "<span class='changed-setting'>video intros</span>, ";
  }
  if (options.video_credits) {
    section_options += "<span class='changed-setting'>video credits</span>, ";
  }
  if (!options.video_intro && !options.video_credits) {
    section_options += "none";
  }
  section_span.innerHTML = section_options;

  // Question set row
  let qset_options = "Display: ";
  if (options.qset_display === "display_one") {
    qset_options += "<span class='changed-setting'>one question at a time</span>, ";
  } else if (options.qset_display === "display_all") {
    qset_options += "<span class='changed-setting'>all questions at once</span>, ";
  } else {
    qset_options += "no change";
  }

  // Numerical things take a little extra checking.
  qset_options += ", Passing: ";
  if (options.pass_percent_no_change) {
    qset_options += "no change";
  } else if (options.pass_percent <= 0 || isNaN(Number(options.pass_percent))) {
    qset_options += "<span class='changed-setting'>no minimum</span>";
  } else if (options.pass_percent > 100 || options.pass_percent < 0) {
    qset_options += "<span class='bad-setting'>" + String(options.pass_percent) + "%</span>";
  } else {
    qset_options += "<span class='changed-setting'>" + String(options.pass_percent) + "%</span>";
  }
  qset_options += ", # Attempts: ";
  if (options.num_attempts_no_change) {
    qset_options += "no change";
  } else if (options.num_attempts <= 0 || isNaN(Number(options.num_attempts))) {
    qset_options += "<span class='changed-setting'>unlimited</span>";
  } else if (options.num_attempts > 10) {
    qset_options += "<span class='bad-setting'>" + String(options.num_attempts) + "</span>";
  } else {
    qset_options += "<span class='changed-setting'>" + String(options.num_attempts) + "</span>";
  }

  qset_options += ", <br>Show answers: ";
  if (options.show_answers === "answers_when_submitted") {
    qset_options += "<span class='changed-setting'>on submission</span>";
  } else if (options.show_answers === "answers_after_attempts") {
    qset_options += "<span class='changed-setting'>after all attempts</span>";
  } else if (options.show_answers === "answers_never") {
    qset_options += "<span class='changed-setting'>never</span>";
  } else {
    qset_options += "no change";
  }

  qset_options += ", Show feedback: ";
  if (options.show_feedback === "feedback_when_submitted") {
    qset_options += "<span class='changed-setting'>on submission</span>";
  } else if (options.show_feedback === "feedback_after_attempts") {
    qset_options += "<span class='changed-setting'>after all attempts</span>";
  } else if (options.show_feedback === "feedback_never") {
    qset_options += "<span class='changed-setting'>never</span>";
  } else {
    qset_options += "no change";
  }
  qset_span.innerHTML = qset_options;

  // Output row
  let output_options = "Output: ";
  if (options.clean) {
    output_options += "<span class='changed-setting'>Clean course</span>, ";
  }
  if (options.spreadsheet) {
    output_options += "Include course spreadsheet";
  } else {
    output_options += "<span class='changed-setting'>No spreadsheet</span>";
  }
  output_span.innerHTML = output_options;

  // Obsolete options
  let obsolete_access = "Locking: ";
  if (options.lock_unlock === "lock") {
    obsolete_access += "<span class='changed-setting'>lock</span>, ";
  } else if (options.lock_unlock === "unlock") {
    obsolete_access += "<span class='changed-setting'>unlock</span>, ";
  } else {
    obsolete_access += "no change, ";
  }
  obsolete_access += "Requirement: ";
  if (options.required_optional === "require") {
    obsolete_access += "<span class='changed-setting'>required</span>";
  } else if (options.required_optional === "optional") {
    obsolete_access += "<span class='changed-setting'>optional</span>";
  } else {
    obsolete_access += "no change";
  }
  obsolete_access_span.innerHTML = obsolete_access;
}

/**
 * Update the "Working" button to show what stage we're in.
 *
 * @param stage The stage we're in. See progress_stage constant for options.
 */
export async function updateStatus(stage: string) {
  let progress_container = document.getElementById("progress_container");
  let progress_bar = document.getElementById("progress_bar");
  let status_text = document.getElementById("processing_status");

  if (!progress_container || !progress_bar || !status_text) {
    console.error("Could not find the progress bar or status text");
    return;
  }

  status_text.innerText = String(stage);
  progress_container.setAttribute("aria-valuenow", String(progress_stage[stage]));
  progress_bar.style.width = String(progress_stage[stage]) + "%";
  console.debug(stage + " (" + progress_stage[stage] + "%)");

  // If we're done, make the progress bar solid.
  if (progress_stage[stage] === 100) {
    progress_bar.classList.remove("progress-bar-animated");
    progress_bar.classList.remove("progress-bar-striped");
  }

  // Why do I have to do this? I think it might be something related to
  // the animation delay for Bootstrap. Without this, the progress
  // bar and text can sometimes skip updates. The code would run faster
  // without this, but honestly not by a lot so it doesn't bother me much.
  // console.debug("500ms break");
  await sleep(500);
}

/**
 * If someone asks to process a 1GB file we should probably warn them.
 * Updated by updateConfirmationDialog()
 *
 * @returns
 */
function makeConfirmationDialog(): void {
  let modal_container = document.createElement("div");
  modal_container.id = "confirmation_dialog_container";
  modal_container.classList.add("modal");
  modal_container.setAttribute("tabindex", "-1");
  modal_container.setAttribute("aria-labelledby", "confirmation_header");
  let modal_dialog = document.createElement("div");
  modal_dialog.classList.add("modal-dialog");
  modal_dialog.classList.add("modal-dialog-centered");
  let modal_content = document.createElement("div");
  modal_content.classList.add("modal-content");

  let modal_header = document.createElement("div");
  modal_header.id = "confirmation_header";
  modal_header.classList.add("modal-header");
  let h2 = document.createElement("h2");
  h2.id = "confirmation_header_text";
  h2.innerText = "Confirm";
  modal_header.appendChild(h2);
  modal_content.appendChild(modal_header);

  let modal_body = document.createElement("div");
  modal_body.id = "confirmation_dialog";
  modal_body.classList.add("modal-body");
  modal_content.appendChild(modal_body);

  let dialog_footer = document.createElement("div");
  dialog_footer.classList.add("modal-footer");
  let close_button = document.createElement("button");
  close_button.id = "close_confirmation";
  close_button.innerText = "Cancel";
  close_button.setAttribute("data-bs-dismiss", "modal");
  close_button.classList.add("btn");
  close_button.classList.add("btn-secondary");
  let confirm_button = document.createElement("button");
  confirm_button.id = "confirm";
  confirm_button.innerText = "Confirm";
  confirm_button.setAttribute("data-bs-dismiss", "modal");
  confirm_button.classList.add("btn");
  confirm_button.classList.add("btn-primary");

  dialog_footer.appendChild(close_button);
  dialog_footer.appendChild(confirm_button);
  modal_content.appendChild(dialog_footer);

  modal_dialog.appendChild(modal_content);
  modal_container.appendChild(modal_dialog);
  document.body.appendChild(modal_container);

  confirm_button.addEventListener("click", () => {
    processFile();
  });
}

/**
 * Keeps the confirmation dialog updated
 *
 * @param input_file
 * @returns
 */
function updateConfirmationDialog(input_file: File): void {
  // Convert size and options to human readable format
  // This jumps through a weird hoop to make a reasonable number of sig figs
  let sillybytes = Math.round((input_file.size / 1024 / 1024) * 100);
  let megabytes = String(sillybytes / 100) + " MB";

  if (input_file.size > 500000000) {
    megabytes =
      megabytes +
      ". This is a very large course. It's gonna take a while. It might hang your browser window";
  }

  let options = getOptions();
  let option_string = "<ul>";
  let option_list: string[] = [];

  Object.keys(options).forEach(function (e, i): void {
    if (typeof human_readable_options[e] === "undefined") {
      return;
    }
    let description = String(
      human_readable_details[String(e)][String(options[e as keyof object]) as keyof object]
    );
    let special_settings = [
      "num_attempts",
      "pass_percent",
      "num_attempts_no_change",
      "pass_percent_no_change",
    ];
    if (special_settings.includes(e)) {
      if (e === "num_attempts") {
        if (options.num_attempts_no_change) {
          description = "<strong>Number of Attempts:</strong> No change.";
        } else if (options.num_attempts <= 0) {
          description = "<strong>Number of Attempts:</strong> setting all to unlimited";
        } else {
          description =
            "<strong>Number of Attempts:</strong> setting all to " + options.num_attempts;
        }
      } else if (e === "pass_percent") {
        if (options.pass_percent_no_change) {
          description = "<strong>Passing Percentage:</strong> No change.";
        } else if (options.pass_percent <= 0) {
          description = "<strong>Passing Percentage:</strong> setting all to no minimum";
        } else {
          description =
            "<strong>Passing Percentage:</strong> setting all to " + options.pass_percent + "%";
        }
      } else if (e === "num_attempts_no_change" || e === "pass_percent_no_change") {
        return;
      }
    } else {
      description = "<strong>" + human_readable_options[e] + ":</strong> " + description;
    }
    option_list.push(description);
  });
  option_list.forEach((e, i) => {
    option_string += `<li>${e}</li>`;
  });
  option_string += "</ul>";

  let modal_body = document.getElementById("confirmation_dialog");
  if (!modal_body) {
    console.error("Could not find the modal body");
    return;
  }

  if (options.download_new_course === false && options.spreadsheet === true) {
    option_string = "Only creating spreadsheet. No changes to course.";
  }
  if (options.test) {
    option_string = "Testing the tarball. No changes will be made.";
  }

  modal_body.innerHTML = `
        <p><b>Preparing to process</b> ${input_file.name}</p>
        <p>It is ${megabytes}.</p>
        <p>Options currently set:</p>
        ${option_string}
    `;
}

/**
 * Takes in the file and sends it off to other functions for processing
 *
 * @returns
 */
async function processFile(): Promise<void> {
  let gzip_blob = new Blob();
  let course_sheet = "";
  let course_name = "processed_course";

  console.debug("Processing file");
  // Show the "working" button
  let working_button = document.getElementById("working_button");
  if (!working_button) {
    console.error("Cannot find the working button");
    return;
  }
  working_button.style.display = "inline-block";

  await updateStatus("Getting options");
  let options = getOptions();
  await updateStatus("Loading file");
  let tar_content = await getTarFiles();
  if (!tar_content) {
    console.error("Could not get tar files");
    return;
  }
  if (options.test) {
    testFile();
    return;
  }

  let json_files = await parseJson(tar_content, options);

  let repo_file = json_files.filter((e: any) => e.name === "repository.json");
  if (repo_file.length === 0) {
    console.error("Could not find repository.json");
    return;
  }
  let repo_data = repo_file[0].data;
  course_name = getCourseName(repo_data);

  console.debug(course_name);
  console.debug(json_files);
  console.debug(options);

  // Only process if we're going to output a new course.
  if (options.download_new_course) {
    // Handles lock, unlock, required, and optional
    if (
      options.lock_unlock !== "no_change" ||
      options.required_optional !== "no_change" ||
      options.section_scope !== "no_change" ||
      options.video_credits ||
      options.video_intro
    ) {
      json_files = await processSections(json_files, options);
      console.debug("Sections processed");
      console.debug(json_files);
    }

    // If we're locking and requiring the course, let's make every video "cannot skip ahead".
    // If we're unlocking, free the videos from the shackles of linear time.
    if (options.lock_unlock === "lock" && options.required_optional === "require") {
      json_files = disableVideoScrubbing(json_files);
      console.debug("Video scrubbing disabled");
    } else if (options.lock_unlock === "unlock") {
      json_files = disableVideoScrubbing(json_files, false);
      console.debug("Video scrubbing enabled");
    }

    if (options.pass_percent_no_change === false || options.num_attempts_no_change === false) {
      json_files = await processQuestionSets(json_files, options);
    }

    // The LXP currently exports things that it itself cannot import.
    // This is surely wise and will never come back to bite them in the-- oh too late.
    // This function zaps the things that break imports.
    if (options.clean) {
      json_files = await cleanCourse(json_files);
      console.debug("Course cleaned");
    }

    // Write json files back to our existing tar.
    gzip_blob = await writeTarFile(tar_content, json_files);
  }

  // Create the course spreadsheet as a csv.
  if (options.spreadsheet) {
    course_sheet = await createCourseSheet(json_files);
  }

  // Make the donwload links
  if (options.download_new_course || options.spreadsheet) {
    makeDownloadLinks(gzip_blob, working_button, course_sheet, course_name);
  }
}

/**
 * Takes in the content from the tarball, gives us back something more usable.
 * @param tar_content
 * @param options
 * @returns an array of objects with the name of the file and the parsed JSON data.
 */
async function parseJson(
  tar_content: Archive,
  options: object
): Promise<{ name: string; data: any }[]> {
  // Get the individual json files from the tarball
  // (We're not altering any other files.)
  await updateStatus("Parsing JSON");
  let json_text = [];
  for await (const f of tar_content.entries) {
    if (f.fileName.includes("/._")) {
      continue;
    }
    if (f.fileName.includes(".json") && f.typeFlag === "0") {
      const filename = f.fileName;
      json_text.push({
        name: filename,
        data_string: f.getContentAsText(),
      });
    }
  }

  // The data attribute has an explicit "any" type, because there are
  // multiple types of JSON files that we'll be working with.
  let json_files: any = [];

  // Parse all the JSON in the files
  json_text.forEach((f) => {
    try {
      json_files.push({
        name: f.name,
        data: JSON.parse(f.data_string),
      });
    } catch (e) {
      console.error("Could not parse JSON for file", f.name);
      console.error(e);
    }
  });

  return json_files;
}

/**
 * This takes in the file, unzips it, untars it,
 * and then literally just tars and zips it back up again.
 *
 * @returns
 */
async function testFile(): Promise<void> {
  let new_tarball = new Archive();

  console.debug("Processing file");
  // Show the "working" spinner
  let working_button = document.getElementById("working_button");
  if (!working_button) {
    console.error("Cannot find the working button");
    return;
  }
  working_button.style.display = "inline-block";

  let tar_content = await getTarFiles();
  if (!tar_content) {
    console.error("Could not get tar files");
    return;
  }

  for (const f of tar_content.entries) {
    console.debug(f.fileNamePrefix);
    console.debug(f.fileName);
    if (f.fileSize === 0) {
      new_tarball.addDirectory(f.fileName);
    } else {
      if (f.fileNamePrefix === "" || f.fileName.startsWith(f.fileNamePrefix)) {
        new_tarball.addBinaryFile(f.fileName, f.toUint8Array());
      } else {
        new_tarball.addBinaryFile(f.fileNamePrefix + "/" + f.fileName, f.content as Uint8Array);
      }
    }
  }

  // Re-gzip the file
  let tarball_uint8 = new_tarball.toUint8Array();
  let gzip_blob = new Blob([gzip(tarball_uint8) as BlobPart], {
    type: "application/gzip",
  });

  makeDownloadLinks(gzip_blob, working_button, "", "test_course");
}

/**
 * Takes in the tgz file, unzips it, untars it, and returns the reader.
 *
 * @returns a TarReader object
 */
async function getTarFiles(): Promise<Archive> {
  // Get the file
  const input_file_element = document.getElementById("input_tarball") as HTMLInputElement;
  if (!input_file_element.files) {
    console.error("Could not find the file");
    return new Promise(() => { });
  }
  if (input_file_element.files.length === 0) {
    console.error("No file uploaded");
    return new Promise(() => { });
  }
  const input_file = input_file_element.files[0];

  // Ungzip the file.
  await updateStatus("Expanding file");
  const input_buffer = new Uint8Array(await input_file.arrayBuffer());
  const file_data = ungzip(input_buffer, {});
  // Untar the file.
  await updateStatus("Extracting data");
  const tar_entries = await Archive.extract(file_data);
  return tar_entries;
}

/**
 * Wraps the processed data in a tarball and gzips it
 * so we can make a download link.
 *
 * @param tar_content
 * @param json_files
 * @param course_sheet
 * @returns The gzipped tarball
 */
async function writeTarFile(
  tar_content: Archive,
  json_files: { name: string; data: any[] }[]
): Promise<Blob> {
  let new_tarball = new Archive();
  await updateStatus("Assembling files");

  const course_structure_files = [
    "activities.json",
    "elements.json",
    "manifest.json",
    "repository.json",
  ];

  for await (const f of tar_content.entries) {
    // console.debug(f.fileName);
    // Skip the . and .. directories
    if (f.fileName === "." || f.fileName === "..") {
      continue;
    }
    if (course_structure_files.includes(f.fileName)) {
      const file_string = JSON.stringify(
        json_files.filter((e) => e.name === f.fileName)[0].data,
        null,
        2
      );
      new_tarball.addTextFile(f.fileName, file_string);
    } else {
      if (f.header.isDirectoryHeader) {
        new_tarball.addDirectory(f.fileName);
      } else {
        if (f.fileNamePrefix === "") {
          new_tarball.addBinaryFile(f.fileName, f.content as Uint8Array);
        } else if (f.fileName.startsWith(f.fileNamePrefix)) {
          // Why this slice? Remove the header and...
          // uh... no idea why the 118 works, but it seems to be universal.
          new_tarball.addBinaryFile(f.fileName, f.toUint8Array().slice(f.header.byteLength, -118));
        } else {
          new_tarball.addBinaryFile(f.fileNamePrefix + "/" + f.fileName, f.content as Uint8Array);
        }
      }
    }
  }

  // Print out all the filenames.
  // for await (const f of new_tarball.entries) {
  //   console.debug(f.fileName);
  // }

  // Re-zip the file
  await updateStatus("Writing file");
  let tarball_uint8 = new_tarball.toUint8Array();
  let gzip_blob = new Blob([gzip(tarball_uint8) as BlobPart], {
    type: "application/gzip",
  });
  return gzip_blob;
}

/**
 * Creates a download link for the importable gzip file.
 * @param gzip_blob
 * @param working_button
 * @returns
 */
async function makeDownloadLinks(
  gzip_blob: Blob,
  working_button: HTMLElement,
  course_sheet: string,
  course_name: string
): Promise<void> {
  // Hide the "working" spinner
  working_button.style.display = "none";

  // Show the download button
  let download_button = document.getElementById("download_button");
  if (!download_button) {
    console.debug("Cannot find the download button");
    return;
  }
  if (gzip_blob.size > 0) {
    console.log("Making course download button work");
    // Provide the file in a Data URI
    let data_uri = URL.createObjectURL(gzip_blob);
    download_button.setAttribute("href", data_uri);
    download_button.setAttribute("download", course_name + ".tgz");
  }
  download_button.classList.add("btn-success");
  download_button.classList.remove("btn-secondary");
  download_button.style.pointerEvents = "auto";
  download_button.style.display = "inline-block";
  document.querySelector("body")?.scrollIntoView();

  // If we have a course sheet, make a download link for that too,
  // but do a hidden one that's triggered when we click the regular download link.
  if (course_sheet !== "") {
    let sheet_blob = new Blob([course_sheet], { type: "text/csv" });
    let sheet_uri = URL.createObjectURL(sheet_blob);
    let sheet_link = document.createElement("a");
    sheet_link.setAttribute("href", sheet_uri);
    sheet_link.id = "spreadsheet_download_link";
    sheet_link.setAttribute("download", "course_sheet_" + course_name + ".csv");
    sheet_link.style.display = "none";
    document.body.appendChild(sheet_link);
    download_button.addEventListener("click", () => {
      sheet_link.click();
    });
  }
  await updateStatus("Download");
}

/////////////////////////////////////////
// Utilities
/////////////////////////////////////////

// Basic sleep function
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms || 1000));
}
