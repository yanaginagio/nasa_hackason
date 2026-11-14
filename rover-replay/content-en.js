// English copy for the authored scenarios. Media, timing, scoring, and source URLs
// stay in assets/accidents.json and assets/events.json for both languages.
const incidents = {
  wheel: {
    title: "The right front wheel stopped turning",
    situation: "The right front wheel is stuck. The rover can still use its other five wheels while dragging the stuck one. Which direction should it drive? Give just the direction.",
    date: "March 13, 2006 (Sol 779)",
    answer: "Spirit drove backward on its five working wheels, dragging its stuck right front wheel. The dragged wheel left a trench in the ground.",
    groups: [{
      name: "Drive backward",
      keywords: ["backward", "backwards", "back", "reverse", "reversing", "back up", "rearward", "rearwards", "in reverse"],
      hint: "Think about which direction the rover should drive.",
    }],
  },
  dune: {
    title: "Stuck in soft sand",
    situation: "The rover’s wheels are buried in soft sand and spinning in place. After testing an escape on Earth, how fast should the wheels turn on Mars? Give a short answer.",
    date: "April 26–June 4, 2005 (Purgatory Dune)",
    answer: "The team used a test rover on Earth to work out how to escape. On Mars, Opportunity turned its wheels slowly in small increments and pulled free after about five weeks.",
    groups: [{
      name: "Turn the wheels slowly in small increments",
      keywords: ["slowly", "slow", "slower", "gradually", "low speed", "small increments", "little by little", "small steps", "in increments"],
      hint: "Think about how quickly to turn the wheels.",
    }],
  },
  computer: {
    title: "The main computer’s memory failed",
    situation: "The main computer’s memory has failed. The rover carries a second computer that can take over. Which computer should the rover switch to?",
    date: "February 28, 2013",
    answer: "Curiosity switched to its backup computer (Side B) and entered safe mode, running only essential functions. It left safe mode on March 2 and continued operating on Side B.",
    groups: [{
      name: "Switch to the backup computer",
      keywords: ["backup", "back up", "spare", "side b", "b side", "computer b", "b computer", "second computer", "other computer", "redundant computer", "b"],
      hint: "The rover carries two computers.",
    }],
  },
  wear: {
    title: "Holes and tears in the wheels",
    situation: "As the rover climbs over rocks, its six wheels experience different loads. What should it adjust about each wheel to reduce those loads as the terrain changes?",
    date: "Damage increased from October 2013. New software arrived in 2017.",
    answer: "The team developed traction control software that adjusts each wheel’s speed to reduce the forces on the wheels. The team sent it to Curiosity in 2017 and regularly photographs the wheels to check for damage.",
    groups: [{
      name: "Adjust how fast each wheel turns",
      keywords: ["speed", "speeds", "rotation rate", "rotational rate", "rotation speed", "rpm", "how fast", "angular velocity"],
      hint: "The wheels cannot be replaced. Think about how the rover could move them differently.",
    }],
  },
  drill: {
    title: "The drill feed stopped working",
    situation: "The drill bit can still spin, but the mechanism that pushes it forward has failed. What part of the rover could move to press the bit into the rock?",
    date: "Failed in December 2016. A new technique worked in February 2018.",
    answer: "The team developed feed-extended drilling, which uses Curiosity’s robotic arm to push the bit into the rock. In February 2018, it successfully drilled a hole on Mars with that technique.",
    groups: [{
      name: "Use the robotic arm",
      keywords: ["arm", "robotic arm", "robot arm", "manipulator"],
      hint: "Think about what holds the drill and how it can move.",
    }],
  },
};

const events = {
  "dust-devil": {
    title: "Dust devil spotted",
    lead: "Perseverance’s Navcam spotted a whirlwind lifting dust along a distant ridge.",
    observed: "Observation: August 30, 2023 (Sol 899), Thorofare Ridge on the western rim of Jezero Crater",
    media: {
      alt: "A dust devil crossing a distant ridge, captured by Perseverance’s Navcam",
      note: "21 frames captured 4 seconds apart and played at 20× speed. Image contrast was enhanced.",
    },
    facts: [
      ["Distance from the rover", "About 4 km"],
      ["Dust devil speed", "About 19 km/h (east to west)"],
      ["Dust devil width", "About 60 m"],
      ["Height visible in the footage", "About 118 m from the ground up"],
    ],
    quiz: {
      question: "The top of the dust devil is outside the frame, but scientists estimated its full height at 2 km. What did they use to estimate it?",
      options: [
        {label: "The length of its shadow on the ground", hint: ""},
        {label: "A second image that captured the top", hint: "The footage only shows the bottom 118 m or so. Look for a clue in these frames."},
        {label: "A measurement from the rover’s radar", hint: "Perseverance has no radar that measures dust devil heights. Look for a clue in the images."},
      ],
      answer: "Scientists estimated the height from the length of the shadow the dust devil cast on the ground. Assuming it was a straight column, it stood about 2 km tall.",
    },
  },
  "bunsen-peak": {
    title: "Rock sampling: Bunsen Peak",
    lead: "You’ve reached the end of the route. Line up the drill with the spot where you’ll collect a sample.",
    observed: "Observation: March 12, 2024 (Sol 1088), Bunsen Peak in Jezero Crater",
    media: {
      alt: "Perseverance’s front camera recording rock coring at Bunsen Peak",
      note: "NASA’s 390× playback of 33 images from a front camera",
    },
    sampling: {
      summary: "This rock core is made mostly of carbonate minerals and silica. Both offer clues about the environment on ancient Mars.",
    },
    facts: [
      ["Sample name", "Comet Geyser (the mission’s 24th sample)"],
      ["Core length", "5.78 cm"],
      ["Rock type", "Carbonate rock cemented by silica"],
    ],
    source: {label: "NASA sampling footage (PIA26314)"},
    detail: {label: "NASA sample profile"},
  },
};

export function englishIncident(data) {
  const copy = incidents[data.id];
  return copy ? {...data, ...copy, language: "en"} : data;
}

export function englishEvent(data) {
  const copy = events[data.id];
  if (!copy) return data;
  return {
    ...data, ...copy,
    media: {...data.media, ...copy.media},
    source: {...data.source, ...copy.source},
    detail: {...data.detail, ...copy.detail},
    ...(data.quiz && {quiz: {...data.quiz, ...copy.quiz}}),
    ...(data.sampling && {sampling: {...data.sampling, ...copy.sampling}}),
  };
}
