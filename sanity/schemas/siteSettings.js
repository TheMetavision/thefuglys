export default {
  name: 'siteSettings',
  title: 'Site Settings',
  type: 'document',
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
  ],
  __experimental_actions: ['update', 'publish'],
};
