export enum CmsRecordKind {
  PROFILE_REQUESTS = 'profile-requests',
  PROJECTS = 'projects',
  PROJECT_ITEMS = 'project-items',
  PROJECT_IMAGES = 'project-images',
  NEWS = 'news',
  NEWS_CATEGORIES = 'news-categories',
  PAGES = 'pages',
  BANNERS = 'banners',
  COOPERATION = 'cooperation',
  RECRUITMENT = 'recruitment',
  CONTACT = 'contact',
  MEDIA = 'media',
  USERS = 'users',
}

export const CMS_RECORDS = {
  [CmsRecordKind.PROFILE_REQUESTS]: {
    model: 'profileChangeRequest',
    title: 'id',
  },
  [CmsRecordKind.PROJECTS]: { model: 'project', title: 'title' },
  [CmsRecordKind.PROJECT_ITEMS]: { model: 'projectItem', title: 'title' },
  [CmsRecordKind.PROJECT_IMAGES]: {
    model: 'projectGalleryImage',
    title: 'caption',
  },
  [CmsRecordKind.NEWS]: { model: 'newsPost', title: 'title' },
  [CmsRecordKind.NEWS_CATEGORIES]: { model: 'newsCategory', title: 'name' },
  [CmsRecordKind.PAGES]: { model: 'page', title: 'title' },
  [CmsRecordKind.BANNERS]: { model: 'banner', title: 'title' },
  [CmsRecordKind.COOPERATION]: { model: 'cooperationProject', title: 'name' },
  [CmsRecordKind.RECRUITMENT]: { model: 'recruitmentPosition', title: 'title' },
  [CmsRecordKind.CONTACT]: { model: 'contactSubmission', title: 'name' },
  [CmsRecordKind.MEDIA]: { model: 'mediaAsset', title: 'publicId' },
  [CmsRecordKind.USERS]: { model: 'user', title: 'name' },
} as const;
