const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export const formatDate = (date: Date) => dateFormat.format(date);

export function readingTime(markdown = '') {
  const words = markdown.replace(/[#*_>`-]/g, ' ').split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.round(words / 220))} min read`;
}
