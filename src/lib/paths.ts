// With `build.format: 'file'`, prerendered pages see pathnames like `/about.html`.
export const cleanPath = (pathname: string) => pathname.replace(/\/index\.html$|\.html$/, '') || '/';
