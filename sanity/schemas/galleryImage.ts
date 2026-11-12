import { defineField, defineType } from 'sanity';

/**
 * galleryImage — a private working or promo image.  [CROSS-BRAND]
 *
 * Identical in thefuglys, labrats, catsoncrack and bikerbabies. Used by
 * character.referenceGallery, worldLocation.referenceGallery and game.gameArt.
 * Read by the Social Content Studio; never queried by the website.
 */
export const GALLERY_IMAGE_KINDS = [
  { title: 'Portrait', value: 'portrait' },
  { title: 'Pose / reference sheet (3D model pose)', value: 'pose' },
  { title: 'Vehicle (kart, bike)', value: 'vehicle' },
  { title: 'Model render (3D game model)', value: 'modelRender' },
  { title: 'Scene (character or location in a scene)', value: 'scene' },
  { title: 'Title card', value: 'titleCard' },
  { title: 'Title card, clean (no lettering)', value: 'titleCardClean' },
  { title: 'Level / track card', value: 'levelCard' },
  { title: 'Stage art (panorama, ground, sign)', value: 'stageArt' },
  { title: 'Promo (made for socials)', value: 'promo' },
];

export default defineType({
  name: 'galleryImage',
  title: 'Gallery image',
  type: 'image',
  options: { hotspot: true },
  fields: [
    defineField({
      name: 'caption',
      title: 'Caption',
      type: 'string',
      description: 'What the image shows, e.g. "Axel in his trolley kart with wheels, sunset junkyard"',
      validation: (rule) => rule.required().max(120),
    }),
    defineField({
      name: 'kind',
      title: 'Kind',
      type: 'string',
      options: { list: GALLERY_IMAGE_KINDS },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'game',
      title: 'Game',
      type: 'string',
      description: 'e.g. "Junkyard Racers", "Scrap Dash"',
    }),
    defineField({
      name: 'level',
      title: 'Level / track',
      type: 'string',
      description: 'e.g. "The Bone Yard", "Chop Shop Circuit"',
    }),
    defineField({
      name: 'source',
      title: 'Source',
      type: 'string',
      description: 'Generator and job id, e.g. "Higgsfield gpt_image_2_6 / 586723bf-…"',
    }),
    defineField({
      name: 'approved',
      title: 'Approved for posts',
      type: 'boolean',
      description: 'Untick to keep the image on file without using it in posts.',
      initialValue: true,
    }),
    defineField({
      name: 'notes',
      title: 'Notes',
      type: 'text',
      rows: 2,
    }),
  ],
  preview: {
    select: { title: 'caption', kind: 'kind', game: 'game', media: 'asset' },
    prepare({ title, kind, game, media }) {
      return {
        title: title || '(no caption)',
        subtitle: [kind, game].filter(Boolean).join(' · '),
        media,
      };
    },
  },
});
