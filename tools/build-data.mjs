import fs from 'node:fs';
const cats = [
 ['image','Image Tools','#e91e63','image','Resize, crop, convert and inspect images'],
 ['pdf','PDF Tools','#f44336','picture_as_pdf','Merge, split, compress and inspect PDFs'],
 ['file','File Tools','#ff9800','folder','File metadata, checksums and utilities'],
 ['text','Text Tools','#3f51b5','text_fields','Format, count, clean and transform text'],
 ['enc','Encoding Tools','#009688','lock','Encode, decode, hash and transform data'],
 ['valid','Validation Tools','#4caf50','verified','Validate common numbers, data and formats'],
 ['gen','Generator Tools','#673ab7','auto_awesome','Generate names, passwords, IDs and sample data'],
 ['random','Random Tools','#795548','casino','Random numbers, choices, shuffles and picks'],
 ['convert','Converter Tools','#2196f3','swap_horiz','Unit, currency and format converters'],
 ['calc','Calculator Tools','#607d8b','calculate','Finance, lifestyle and general calculators'],
 ['math','Math Tools','#00bcd4','functions','Algebra, geometry and statistical helpers'],
 ['date','Date Tools','#8bc34a','event','Date, time, duration and calendar tools'],
 ['health','Health Tools','#c2185b','favorite','BMI, nutrition and wellness calculators'],
 ['web','Web Tools','#1976d2','language','SEO, URL and website helper tools'],
 ['dev','Developer Tools','#455a64','code','JSON, CSS, HTML and programming utilities'],
 ['color','Color Tools','#9c27b0','palette','Color conversion, contrast and palette tools'],
 ['network','Network Tools','#00695c','router','IP, DNS and network calculators']
];
const base = {
 image:['Image Resizer','PNG to JPG Converter','Image Compressor','Crop Image','Base64 Image Encoder','EXIF Viewer','Image Dimension Checker'],
 pdf:['PDF Merger','PDF Splitter','PDF Compressor','PDF Page Counter','PDF Metadata Viewer','PDF Password Helper'],
 file:['File Size Converter','Checksum Generator','MIME Type Checker','File Extension Lookup','Duplicate File Name Finder'],
 text:['Word Counter','Character Counter','Case Converter','Slug Generator','Lorem Ipsum Generator','Text Diff Checker','Remove Duplicate Lines'],
 enc:['Base64 Encoder Decoder','URL Encoder Decoder','MD5 Hash Generator','SHA256 Hash Generator','JWT Decoder','HTML Entity Encoder'],
 valid:['Email Validator','URL Validator','IBAN Validator','Credit Card Validator','JSON Validator','UUID Validator'],
 gen:['Password Generator','UUID Generator','QR Code Generator','Barcode Generator','Username Generator','API Key Generator'],
 random:['Random Number Generator','Random List Picker','Coin Flip','Dice Roller','Random Password','Shuffle List'],
 convert:['Length Converter','Weight Converter','Temperature Converter','Currency Converter','Speed Converter','Area Converter'],
 calc:['Percentage Calculator','Loan Calculator','GST Calculator','Discount Calculator','Tip Calculator','Compound Interest Calculator'],
 math:['Prime Number Checker','GCD Calculator','LCM Calculator','Triangle Calculator','Mean Median Mode','Equation Solver'],
 date:['Age Calculator','Days Between Dates','Date Add Subtract','Unix Timestamp Converter','Week Number Calculator'],
 health:['BMI Calculator','BMR Calculator','Calorie Calculator','Water Intake Calculator','Body Fat Calculator'],
 web:['Meta Tag Analyzer','Robots TXT Generator','Sitemap Generator','URL Parser','Open Graph Preview','HTTP Status Checker'],
 dev:['JSON Formatter','CSS Minifier','HTML Beautifier','Regex Tester','Unix Time Converter','YAML to JSON'],
 color:['Color Converter','HEX to RGB','RGB to HSL','Contrast Checker','Palette Generator','Gradient Generator'],
 network:['IP Lookup','Subnet Calculator','DNS Lookup','Port Checker','CIDR Calculator','Ping Simulator']
};
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const data = {categories: []};
for (const [key,name,color,icon,desc] of cats) {
  const tools=[]; let n=0;
  for (const b of base[key]) tools.push({name:b, slug:slug(b), desc:`Free online ${b.toLowerCase()} for fast, private browser calculations.`, cat:key, type:key+'-basic', popular:n++<2});
  const target = key==='convert' || key==='calc' || key==='math' || key==='text' || key==='image' ? 75 : 58;
  for (let i=1; tools.length<target; i++) {
    const label = `${name.replace(' Tools','')} Helper ${i}`;
    tools.push({name:label, slug:slug(label), desc:`Specialized ${label.toLowerCase()} with instant results and clean output.`, cat:key, type:key+'-basic'});
  }
  data.categories.push({key,name,color,icon,desc,tools});
}
fs.writeFileSync('assets/js/data.json', JSON.stringify(data,null,2));
fs.writeFileSync('assets/js/data.js', 'window.SUMLY_DATA = '+JSON.stringify(data)+';\n');
function phpValue(v, indent = 0) {
  const pad = ' '.repeat(indent);
  const next = ' '.repeat(indent + 2);
  if (Array.isArray(v)) return `[\n${v.map(x => next + phpValue(x, indent + 2)).join(',\n')}\n${pad}]`;
  if (v && typeof v === 'object') return `[\n${Object.entries(v).map(([k,val]) => `${next}'${k.replace(/'/g, "\\'")}' => ${phpValue(val, indent + 2)}`).join(',\n')}\n${pad}]`;
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v === null) return 'null';
  return String(v);
}
for (const c of data.categories) {
  const payload = {categories:[c],featured:c.tools.filter(t=>t.popular)};
  fs.writeFileSync(`includes/data/tools-${c.key}.php`, `<?php\nreturn ${phpValue(payload)};\n`);
}
console.log(`Generated ${data.categories.reduce((a,c)=>a+c.tools.length,0)} tools`);
