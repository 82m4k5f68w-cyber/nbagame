// LIFE voice lines (radio in a ZipRide, phone voicemail): generic, no names. Rendered into the voice bank's `l`
// namespace by scripts/assets/voice.ts (third Piper voice, phone / radio band); client/voice.ts speaks the same text
// with browser speech when the bank or the clip is missing.
export const LIFE_LINES: Record<string, string> = {
  vm_new: "You have one new voicemail.",
  vm_coach1: "Hey, it's Coach. Don't be late to practice. We go at the scheduled time, not a minute after.",
  vm_coach2: "Coach here. Good work out there. Keep your legs fresh and your grades up.",
  vm_coach3: "It's Coach. Film session soon. Bring a notebook and an open mind.",
  vm_agent: "Hey, it's your agent. Call me back when you get a second. We've got things to talk about.",
  vm_mom: "Hi sweetie, it's Mom. Just checking in. Proud of you. Eat something green today.",
  vm_friend: "Yo, it's me. Pickup at the Cage later? Don't leave me hanging.",
  vm_end: "End of messages.",
  radio_id: "You're listening to Hoops Radio, ninety-eight point five.",
  radio_1: "Big night at Summit Arena coming up. Get there early, the place will be loud.",
  radio_2: "Traffic is moving fine on Main Street and Market Street this hour.",
  radio_3: "Up next, the top plays of the week, and one of them is a poster you have to hear to believe.",
  radio_4: "Weather: clear skies, light wind. Perfect for a run at the Cage.",
  radio_5: "Stay with us. More hoops talk right after the break.",
  radio_6: "Students, remember: midterms are around the corner. Hit the library.",
};
