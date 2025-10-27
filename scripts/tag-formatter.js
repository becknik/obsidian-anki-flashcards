var tagEl = document.querySelector('.tags');
var tags = tagEl.innerHTML.split(' ');

tagEl.innerHTML = tags.reduce((acc, tag) => {
  if (!tag) return acc;
  const newTag = '<span class="tag">' + tag + '</span>';
  return acc + newTag;
}, '');
