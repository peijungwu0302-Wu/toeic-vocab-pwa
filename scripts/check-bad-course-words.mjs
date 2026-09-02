import fs from 'node:fs';

const course = JSON.parse(fs.readFileSync('public/data/v1/courses/course-core-1200.json', 'utf8'));
const coreMaster = JSON.parse(fs.readFileSync('public/data/v1/core-1200.json', 'utf8'));

const badInCourse = course.words.filter(w => /All employees are strongly advised/i.test(w.examples?.[0]?.en || ''));
console.log(`course-core-1200.json 中有 ${badInCourse.length} 個單字 ex0 是模板！`);
if (badInCourse.length > 0) {
  console.log('Sample bad in course:', badInCourse[0].headword, badInCourse[0].id);
  const masterWord = coreMaster.words.find(w => w.id === badInCourse[0].id || w.headword === badInCourse[0].headword);
  console.log('In core-1200.json:', masterWord?.headword, masterWord?.examples?.[0]);
}
