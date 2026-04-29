export default {
  name: 'siteSettings',
  title: 'Site Settings',
  type: 'document',
  fieldsets: [
    {
      name: 'themeAudio',
      title: 'Theme audio',
      description: 'Site-wide theme tune ("Transmission Signal"). Click-to-play, persists across pages.',
      options: { collapsible: true, collapsed: true },
    },
  ],
  fields: [
    {
      name: 'siteName',
      title: 'Site Name',
      type: 'string',
      initialValue: 'The Fuglys',
    },
    {
      name: 'tagline',
      title: 'Tagline',
      type: 'string',
      initialValue: 'Wasteland Weirdos, Wild Adventures, Zero Regrets!',
    },
    {
      name: 'siteDescription',
      title: 'Site Description',
      type: 'text',
      rows: 3,
      initialValue:
        'Join The Fuglys — an unruly band of wasteland misfits — in animated adventures, blog stories & merch drops.',
    },
    {
      name: 'contactEmail',
      title: 'Contact Email',
      type: 'string',
      initialValue: 'contact@thefuglys.com',
    },
    {
      name: 'youtubeChannel',
      title: 'YouTube Channel URL',
      type: 'url',
    },
    {
      name: 'socialLinks',
      title: 'Social Links',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            {
              name: 'platform',
              title: 'Platform',
              type: 'string',
              options: {
                list: [
                  'Instagram',
                  'TikTok',
                  'X',
                  'Facebook',
                  'YouTube',
                  'Threads',
                ],
              },
            },
            { name: 'url', title: 'URL', type: 'url' },
          ],
        },
      ],
    },
    {
      name: 'announcementBar',
      title: 'Announcement Bar',
      type: 'string',
      description: 'Text displayed at the top of every page',
    },
    {
      name: 'logo',
      title: 'Logo',
      type: 'image',
    },
    {
      name: 'footerLogo',
      title: 'Footer Logo',
      type: 'image',
    },
    {
      name: 'footerText',
      title: 'Footer Text',
      type: 'text',
      rows: 2,
      initialValue: '© The Metavision 2026. All rights reserved.',
    },
    {
      name: 'newsletterHeadline',
      title: 'Newsletter Headline',
      type: 'string',
      initialValue: 'Stay Weird. Stay Wild. Stay in the Loop!',
    },
    {
      name: 'newsletterSubtext',
      title: 'Newsletter Subtext',
      type: 'string',
      initialValue: 'Subscribe to our newsletter',
    },
    // ─── Theme audio (Transmission Signal) ─────────────────────────
    // Added 2026-04-29. Per Arc spec arc-spec-fuglys-theme-tune-content-2026-04-29.md
    // and master brief IP-Brand-Theme-Tunes-Build-Brief.md.
    {
      name: 'themeTrackTitle',
      title: 'Theme track title',
      type: 'string',
      fieldset: 'themeAudio',
      description: 'Display title for the theme tune. Surfaces in expanded-state tooltip and ARIA fallbacks.',
      initialValue: 'The Fuglys Main Theme',
    },
    {
      name: 'themeTrackArtist',
      title: 'Theme track composer / artist credit',
      type: 'string',
      fieldset: 'themeAudio',
      description: 'Optional. Composer or artist credit. Shown in expanded-state if present.',
      initialValue: '[Composer credit TBC — Alan to confirm]',
    },
    {
      name: 'themeAudioFile',
      title: 'Theme audio file (.mp3)',
      type: 'file',
      fieldset: 'themeAudio',
      description: 'Upload the .mp3 here. The original .wav stays on the local master. Sanity serves the .mp3 from its CDN.',
      options: { accept: 'audio/mpeg,audio/mp3' },
    },
    {
      name: 'themeEnabled',
      title: 'Theme audio enabled',
      type: 'boolean',
      fieldset: 'themeAudio',
      description: 'Master kill switch. Set to false to hide the control across the entire site without a code deploy.',
      initialValue: true,
    },
    {
      name: 'themeAutoplayPolicy',
      title: 'Autoplay policy',
      type: 'string',
      fieldset: 'themeAudio',
      description: 'Reserved for future flexibility. Currently only "click-to-play" is supported by the component.',
      initialValue: 'click-to-play',
      readOnly: true,
      options: {
        list: [
          { title: 'Click to play (default — recommended)', value: 'click-to-play' },
        ],
        layout: 'radio',
      },
    },
  ],
  __experimental_actions: ['update', 'publish'],
};
