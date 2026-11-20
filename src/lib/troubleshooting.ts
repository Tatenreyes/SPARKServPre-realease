/**
 * Preliminary troubleshooting guides, keyed by canonical issue.
 *
 * These are **optional preliminary checks**, never a professional diagnosis and
 * never a repair instruction. Every step is deliberately conservative: look,
 * listen, check the obvious, and stop if anything looks unsafe.
 *
 * ## How a guide is found
 * `getTroubleshootingGuide(applianceType, issueId)` looks up
 *   1. `${applianceSlug}/${issueId}`, an appliance-specific override, then
 *   2. `issueId`, the shared guide for that issue.
 * It returns `null` when the issue has no guide (or does not belong to the
 * appliance), and the form then says so instead of inventing instructions.
 *
 * ## Safety rules for anyone adding a step
 *   * no opening cabinets, panels or covers;
 *   * no exposed wiring, no work on live parts, no refrigerant handling;
 *   * no bypassing safety interlocks, no component-level repair;
 *   * anything past "switch it off, plug it back in, clean the filter" ends with
 *     `STOP_AND_BOOK`.
 * `scripts/tests/troubleshooting-guides.test.mjs` fails the suite if a step
 * breaks these rules.
 */

import { applianceSlug, getIssueById, type ApplianceIssue } from "./appliance-issues.ts";

export interface TroubleshootingStep {
  title: string;
  detail: string;
}

/** Shown above every guide, so the framing can never drift per screen. */
export const TROUBLESHOOTING_DISCLAIMER =
  "These are optional preliminary checks, not a professional diagnosis. You can skip them at any time and continue with your repair request.";

/** Shown when the identified issue has no guide. */
export const NO_GUIDE_MESSAGE =
  "No troubleshooting guide is available for this issue. You can continue with your repair request.";

// ---------------------------------------------------------------- shared steps

const SAFETY_OFF: TroubleshootingStep = {
  title: "Switch it off first",
  detail:
    "Switch the unit off and unplug it (or switch off its breaker) before checking anything. If you smell burning or see damaged cables, stop and submit your request.",
};

const POWER_OUTLET: TroubleshootingStep = {
  title: "Confirm the power",
  detail:
    "Make sure the plug is fully seated and test the outlet with another device. Reset the breaker if it has tripped.",
};

const POWER_SWITCH: TroubleshootingStep = {
  title: "Check the unit's own switch",
  detail:
    "Some units have a power switch or child lock of their own, make sure it is on, then wait a few seconds for the display.",
};

const NO_OPEN: TroubleshootingStep = {
  title: "Keep to the outside",
  detail:
    "Everything below is done from outside the unit. Anything inside it, motors, wiring or gas lines, is a job for a qualified technician.",
};

const WATER_SHUTOFF: TroubleshootingStep = {
  title: "Stop the water and dry the area",
  detail:
    "Turn off the water supply and the power, then dry the floor so nobody slips before checking anything else.",
};

const HOSE_CHECK: TroubleshootingStep = {
  title: "Check the visible hoses and seals",
  detail:
    "Look for kinks, cracks or loose connections on the hoses and seals you can see from outside. Do not unscrew fittings to investigate further.",
};

const CAPTURE_CODE: TroubleshootingStep = {
  title: "Write down the error code",
  detail:
    "Note the exact code or flashing pattern on the display, it narrows the fault down quickly for the technician.",
};

const POWER_CYCLE: TroubleshootingStep = {
  title: "Power-cycle it once",
  detail:
    "Unplug the unit for a full minute, plug it back in and see whether the code clears on its own.",
};

const NOTE_NOISE: TroubleshootingStep = {
  title: "Note when the noise happens",
  detail:
    "Write down whether it starts on power-up, spinning, draining or cooling, and whether it is a rattle, grind or hum, it helps the technician a lot.",
};

const CLEAR_OBSTRUCTION: TroubleshootingStep = {
  title: "Clear anything in the way",
  detail:
    "With the unit switched off, move anything that touches or blocks it, and make sure it stands level on a firm surface.",
};

const TEMP_SETTING: TroubleshootingStep = {
  title: "Check the setting",
  detail:
    "Confirm the thermostat or mode is where you expect, then give the unit a few hours to recover before judging it.",
};

const DOOR_SEAL: TroubleshootingStep = {
  title: "Check the door seal",
  detail:
    "Close the door firmly and run a hand along the seal for gaps, cracks or food caught in it.",
};

const CLEAR_VENTS: TroubleshootingStep = {
  title: "Clear the vents and airflow",
  detail:
    "Make sure vents, filters and the space around the unit are not blocked by food, dust or furniture.",
};

const FILTER_CLEAN: TroubleshootingStep = {
  title: "Clean the filter",
  detail: "With the appliance switched off, follow the manual for a filter designed for routine cleaning. Skip this check if you need tools or must remove a service panel.",
};

const DRAIN_CHECK: TroubleshootingStep = {
  title: "Check the drain and filter",
  detail:
    "Look for a kinked or blocked drain hose, and clean the visible lint or debris filter if your machine has one.",
};

const LOAD_LID: TroubleshootingStep = {
  title: "Check the load and the lid",
  detail: "Reduce an overloaded drum and make sure the lid or door is fully latched.",
};

const INPUT_CHECK: TroubleshootingStep = {
  title: "Check the cables and source",
  detail:
    "Reseat the power and signal cables, then try another source, channel or input to see whether the fault follows the unit.",
};

const REMOTE_CHECK: TroubleshootingStep = {
  title: "Try the remote's basics",
  detail:
    "Fit fresh batteries, point the remote straight at the unit, and check whether the unit's own panel buttons still work.",
};

const STOP_AND_BOOK: TroubleshootingStep = {
  title: "If it is not fixed, stop there",
  detail:
    "Do not open the unit or attempt a repair. Submit your request and a qualified technician will take it from here.",
};

// ---------------------------------------------------------------------- guides

const GUIDES: Record<string, TroubleshootingStep[]> = {
  "not-cooling": [TEMP_SETTING, DOOR_SEAL, CLEAR_VENTS, NO_OPEN, STOP_AND_BOOK],
  // An air conditioner has no door, and its filter is the usual culprit.
  "air-conditioner/not-cooling": [
    { ...TEMP_SETTING, title: "Check the mode and setting" },
    FILTER_CLEAN,
    {
      title: "Give the outdoor unit room",
      detail:
        "Clear leaves, boxes or laundry away from the outdoor unit so air can move through it.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-turning-on": [POWER_OUTLET, POWER_SWITCH, NO_OPEN, STOP_AND_BOOK],
  "leaking-water": [SAFETY_OFF, WATER_SHUTOFF, HOSE_CHECK, NO_OPEN, STOP_AND_BOOK],
  leaking: [SAFETY_OFF, WATER_SHUTOFF, HOSE_CHECK, NO_OPEN, STOP_AND_BOOK],
  "making-unusual-noise": [NOTE_NOISE, CLEAR_OBSTRUCTION, NO_OPEN, STOP_AND_BOOK],
  "making-noise": [NOTE_NOISE, CLEAR_OBSTRUCTION, NO_OPEN, STOP_AND_BOOK],
  "error-code": [CAPTURE_CODE, POWER_CYCLE, NO_OPEN, STOP_AND_BOOK],
  "weak-airflow": [FILTER_CLEAN, CLEAR_VENTS, NO_OPEN, STOP_AND_BOOK],
  "not-spinning": [
    LOAD_LID,
    {
      title: "Check it stands level",
      detail: "A machine that rocks or leans can refuse to spin, check the feet and the floor.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-draining": [DRAIN_CHECK, NO_OPEN, STOP_AND_BOOK],
  "not-filling": [
    {
      title: "Check the tap and inlet hose",
      detail: "Confirm the water tap is fully open and the inlet hose is not kinked or squashed.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-heating": [POWER_OUTLET, TEMP_SETTING, NO_OPEN, STOP_AND_BOOK],
  "electric-stove/not-heating": [
    {
      title: "Identify the burner that stopped heating",
      detail: "From what you already noticed, note which burner was affected and whether the others worked. Compare the selected control and heat setting with your model's manual. Leave the burners off and let the cooktop cool.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "electric-stove/not-turning-on": [
    {
      title: "Look for a control-lock indicator",
      detail: "If your stove has touch controls, look for a lock symbol and check its meaning in your model's manual. Note whether the display was blank or the controls lit up but did not respond.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "electric-fan/not-spinning": [
    {
      title: "Note how the fan stopped",
      detail: "With the fan switched off, note whether it hummed, stopped suddenly, or never started. Keep your fingers and tools outside the grille.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "microwave-oven/not-heating": [
    {
      title: "Check the setting and the door",
      detail:
        "Confirm the power level and timer are set, and that the door latches fully. Never run a microwave empty or with the door open.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "water-heater/not-heating": [
    {
      title: "Check the breaker and the valve",
      detail:
        "Confirm the breaker is on and the water valve is open. Do not open the unit or drain it yourself.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "electric-kettle/not-heating": [
    {
      title: "Check the base and the lid",
      detail: "Make sure the kettle sits squarely on its base, the lid is closed and the base is dry.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-freezing": [TEMP_SETTING, DOOR_SEAL, CLEAR_VENTS, NO_OPEN, STOP_AND_BOOK],
  "freezer-not-freezing": [TEMP_SETTING, DOOR_SEAL, CLEAR_VENTS, NO_OPEN, STOP_AND_BOOK],
  "over-freezing": [
    { ...TEMP_SETTING, title: "Check the temperature dial" },
    {
      title: "Check the placement",
      detail: "Keep food away from the rear vents and off the coldest shelf while you wait.",
    },
    STOP_AND_BOOK,
  ],
  "not-defrosting": [
    DOOR_SEAL,
    {
      title: "Check the defrost drain",
      detail:
        "Look at the back of the fridge compartment for a blocked drain. Do not chip at the ice with a tool.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-making-ice": [
    {
      title: "Check the ice maker basics",
      detail:
        "Confirm the ice maker is switched on and the freezer has reached its normal temperature.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "ice-frost-formation": [
    {
      title: "Switch off and let it thaw",
      detail: "Switch the unit off and let the ice melt naturally. Never chip or pry at it.",
    },
    FILTER_CLEAN,
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "remote-not-working": [REMOTE_CHECK, NO_OPEN, STOP_AND_BOOK],
  "no-display": [INPUT_CHECK, POWER_OUTLET, NO_OPEN, STOP_AND_BOOK],
  "no-sound": [
    {
      title: "Check volume and mute",
      detail:
        "Confirm the volume is up, mute is off, and the audio output is set to the right speaker.",
    },
    INPUT_CHECK,
    STOP_AND_BOOK,
  ],
  "screen-flickering": [
    INPUT_CHECK,
    {
      title: "Check the outlet",
      detail:
        "If a heavy appliance shares the same outlet or extension lead, try a different outlet and see whether the flicker stops.",
    },
    STOP_AND_BOOK,
  ],
  "lines-on-screen": [INPUT_CHECK, NO_OPEN, STOP_AND_BOOK],
  "weak-suction": [
    {
      title: "Empty it and clean the filter",
      detail: "With the vacuum off, check the bin and the user-accessible filter. Follow the owner manual for normal cleaning and keep the service panels closed.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-dispensing": [
    {
      title: "Check the water supply",
      detail: "Confirm the bottle or tank has water, the tap is not blocked and the unit is level.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-cooling-heating": [
    {
      title: "Check the mode switch",
      detail:
        "Confirm the cooling/heating switch is on the side you expect, then give it a few minutes to change over.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  "not-cooking": [
    {
      title: "Check the pot and the plate",
      detail:
        "Confirm the inner pot sits flat, the heating plate is clean and dry, and the switch clicks down when you press it.",
    },
    NO_OPEN,
    STOP_AND_BOOK,
  ],
  // `other` deliberately has NO guide: SPARKServ does not know what the fault is,
  // so it says so instead of inventing instructions.
};


/**
 * The guide for an identified issue, or `null` when there is none.
 *
 * The issue must belong to the appliance, an issue id from another appliance's
 * catalogue returns `null`, so instructions can never appear under the wrong
 * appliance. There is deliberately NO appliance-only lookup: knowing the
 * appliance tells us nothing about what is wrong with it, which is exactly why
 * the old rail showed steps the moment an appliance was picked.
 */
export function getTroubleshootingGuide(
  applianceType: string,
  issueId: string | null | undefined
): TroubleshootingStep[] | null {
  const issue: ApplianceIssue | null = getIssueById(applianceType, issueId);
  if (!issue) return null;

  const specific = GUIDES[`${applianceSlug(applianceType)}/${issue.id}`];
  if (specific?.length) return specific;

  const shared = GUIDES[issue.id];
  return shared?.length ? shared : null;
}

// Review each step before adding it to the customer walkthrough.
const EXTERNAL_CHECKS = new Set([
  "Identify the burner that stopped heating",
  "Look for a control-lock indicator",
  "Note how the fan stopped",
  "Check the load and the lid",
  "Check the setting and the door",
  "Check the base and the lid",
  "Check the pot and the plate",
  "Check the mode switch",
  "Check the water supply",
  "Empty it and clean the filter",
  "Check volume and mute",
  "Check the ice maker basics",
  "Check the setting",
  "Check the mode and setting",
  "Check the temperature dial",
  "Check the door seal",
  "Clear the vents and airflow",
  "Clean the filter",
  "Note when the noise happens",
  "Try the remote's basics",
]);

const GUIDED_OBSERVATIONS: Record<string, TroubleshootingStep> = {
  "not-turning-on": {
    title: "Look for signs of power",
    detail: "Note whether the display or indicator was blank, or came on but did not respond. Leave plugs, wiring and breakers alone if there is damage or moisture.",
  },
  "leaking-water": {
    title: "Identify where the water appeared",
    detail: "With the appliance off, look from a dry spot and note whether the water appeared inside, underneath, or at a visible connection. Stay clear of water near electrical parts.",
  },
  "not-draining": {
    title: "Note where water remains",
    detail: "With the appliance off, note where water is visible. If a drain hose is already in view, look for a kink without moving the appliance or disconnecting anything.",
  },
  "not-filling": {
    title: "Check the visible water supply",
    detail: "With the washer off, look for a closed supply tap or a kink in the visible inlet hose. Keep the hose connected and avoid moving the washer.",
  },
  "no-display": {
    title: "Check the screen and selected input",
    detail: "Note whether the power light is on and whether the screen says No Signal. If the TV menu opens normally, check which source is selected.",
  },
  "screen-flickering": {
    title: "Check where the picture flickers",
    detail: "From what you observed, note whether the flicker affects one app or input, or also appears in the television menu.",
  },
  "lines-on-screen": {
    title: "Check where the lines appear",
    detail: "From what you observed, note whether the lines appear on one source or also on the television menu.",
  },
  "not-defrosting": {
    title: "Note where frost builds up",
    detail: "Look for frost around the door seal, inside the compartment, or both. Leave the ice in place and avoid using tools to remove it.",
  },
  "induction-cooker/not-heating": {
    title: "Check cookware compatibility",
    detail: "With the cooker off and cool, compare the pan type and base size with the model manual. Note if the pan was centered on the cooking zone.",
  },
  "water-heater/not-heating": {
    title: "Check the temperature setting",
    detail: "Look at the external controls and note the temperature setting and any indicator lights. Leave the cover closed and the appliance off if it leaks.",
  },
  "clothes-dryer/not-spinning": {
    title: "Check the door and cycle",
    detail: "With the dryer off, look for clothing caught in the door and note which cycle was selected.",
  },
  "clothes-dryer/not-draining": {
    title: "Check the water tank indicator",
    detail: "If your dryer has a condensate tank, check whether the display showed a full-tank warning. Use the model manual to identify the tank and its normal maintenance.",
  },
  "clothes-dryer/not-heating": {
    title: "Check the dryer cycle setting",
    detail: "Note whether the selected cycle is timed, heated, or air-only. Check the cycle description in the manual for your model.",
  },
  "electric-fan/weak-airflow": {
    title: "Check the fan speed and grille",
    detail: "With the fan off, note the speed setting and look for dust on the outside of the grille. Keep fingers and tools out of the grille.",
  },
};

export function getGuidedTroubleshootingSteps(
  applianceType: string,
  issueId: string | null | undefined
): TroubleshootingStep[] {
  const issue = getIssueById(applianceType, issueId);
  if (!issue) return [];

  if (issue.id === "error-code") {
    return [{
      title: CAPTURE_CODE.title,
      detail: "If the display already shows an error code or warning light, write it down or take a photo. Look up the exact code in the manual for your model.",
    }];
  }

  const symptom = issue.id === "leaking" ? "leaking-water" : issue.id;
  const observation = GUIDED_OBSERVATIONS[`${applianceSlug(applianceType)}/${symptom}`];
  if (observation) return [observation];

  const checks = (getTroubleshootingGuide(applianceType, issueId) ?? []).filter(
    (step) => EXTERNAL_CHECKS.has(step.title)
  );

  if (checks.length) return checks;

  const sharedObservation = GUIDED_OBSERVATIONS[symptom];
  if (sharedObservation) return [sharedObservation];

  return [{
    title: "Note when the symptom happens",
    detail: "From what you already noticed, describe when the problem starts and whether it happens every time. Leave the appliance off if using it seems unsafe.",
  }];
}
