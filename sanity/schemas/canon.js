// canon.js — consistency canon shared by the four IP brand Studios (identical in
// thefuglys, labrats, catsoncrack, thebikerbabies: change one, copy to all four).
// Studio and generation tooling only: the website never queries these fields.
//
// proportionsField: per-character scale and proportion rules, checked on every
// generated image. brandCanon: one singleton per brand holding the master line-up
// and the group rules that every multi-character generation must follow.

export const proportionsField = {
  name: 'proportions',
  title: 'Proportions & scale (canon)',
  type: 'object',
  description: 'Locked size and proportion rules for this character. Every generation is checked against these and the brand line-up. Not shown on the website.',
  options: { collapsible: true, collapsed: true },
  fields: [
    { name: 'relativeHeight', title: 'Relative height', type: 'number', description: 'Standing height compared with the brand’s anchor character (Brand Canon) = 1.00. e.g. 0.75 = three-quarters of the anchor’s height.', validation: (Rule) => Rule.min(0.05).max(10) },
    { name: 'heightNote', title: 'Height in words', type: 'string', description: 'How it reads next to others, e.g. "top of head level with Luna’s eyes".' },
    { name: 'headsTall', title: 'Heads tall', type: 'number', description: 'Total standing height measured in head-heights, e.g. 2.5 for chibi, 4 for a lanky cartoon adult.', validation: (Rule) => Rule.min(1).max(9) },
    { name: 'build', title: 'Build', type: 'string', description: 'e.g. "lanky, long legs, narrow shoulders".' },
    { name: 'ageRead', title: 'Age read', type: 'string', description: 'How old the character must read, e.g. "toddler: big head, short limbs, chubby cheeks".' },
    { name: 'silhouetteChecks', title: 'Must always be true', type: 'array', of: [{ type: 'string' }], description: 'Signature features checked on every image, e.g. "segmented chrome metal tail attached at the base of the spine".' },
    { name: 'neverList', title: 'Never', type: 'array', of: [{ type: 'string' }], description: 'e.g. "never taller than Whiskers", "never adult proportions".' },
    { name: 'lineupCrop', title: 'Line-up crop', type: 'image', description: 'This character cut from the approved brand line-up, for use as a scale reference.' },
    { name: 'lockedAt', title: 'Locked on', type: 'date' },
  ],
};

export const brandCanon = {
  name: 'brandCanon',
  title: 'Brand Canon',
  type: 'document',
  description: 'Consistency rules for every image and video of this brand. Studio and generation tooling only.',
  fields: [
    { name: 'title', title: 'Title', type: 'string', initialValue: 'Brand Canon' },
    { name: 'anchorCharacter', title: 'Anchor character', type: 'reference', to: [{ type: 'character' }], description: 'Relative heights on character records are measured against this character (= 1.00).' },
    { name: 'lineup', title: 'Master line-up', type: 'image', description: 'Every character standing side by side against a faint height chart. Attached to every generation with more than one character.' },
    { name: 'lineupOrder', title: 'Height order (tallest first)', type: 'array', of: [{ type: 'reference', to: [{ type: 'character' }] }] },
    { name: 'artRegister', title: 'Art register', type: 'text', rows: 4, description: 'The look every image must match (style, realism, palette).' },
    { name: 'groupRules', title: 'Group-shot rules', type: 'array', of: [{ type: 'string' }], description: 'Rules for multi-character images, e.g. "relative heights must match the line-up".' },
    { name: 'neverList', title: 'Brand never list', type: 'array', of: [{ type: 'string' }] },
    { name: 'lockedAt', title: 'Locked on', type: 'date' },
  ],
  preview: { prepare: () => ({ title: 'Brand Canon' }) },
};
