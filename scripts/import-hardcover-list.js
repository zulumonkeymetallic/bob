#!/usr/bin/env node
/**
 * Import a CSV list of books into Hardcover:
 * - Creates (or finds) a list called "modern wisdom 100"
 * - Inserts/upserts books with want-to-read status
 * - Links them to the list
 *
 * Usage:
 *   HARDCOVER_TOKEN=... node scripts/import-hardcover-list.js
 */

const fetch = global.fetch;
const TOKEN = process.env.HARDCOVER_TOKEN;
const BASE = 'https://api.hardcover.app/v1/graphql';

if (!TOKEN) {
  console.error('Set HARDCOVER_TOKEN to your Hardcover API token.');
  process.exit(1);
}

// Title,Author,Exclusive Shelf
const rows = `
The Precipice: Existential Risk and the Future of Humanity,Toby Ord,to-read
The Almanack of Naval Ravikant,Eric Jorgenson,to-read
Atomic Habits,James Clear,to-read
The Ape that Understood the Universe,Steve Stewart-Williams,to-read
Essentialism: The Disciplined Pursuit of Less,Greg McKeown,to-read
The Moral Animal,Robert Wright,to-read
The Art of Impossible,Steven Kotler,to-read
The Forgotten Highlander,Alistair Urquhart,to-read
When Men Behave Badly,David Buss,to-read
Chasing Excellence,Ben Bergeron,to-read
The Happiness Hypothesis,Jonathan Haidt,to-read
Never Split the Difference,Chris Voss,to-read
Superintelligence,Nick Bostrom,to-read
The Obstacle Is The Way,Ryan Holiday,to-read
The Daily Stoic,Ryan Holiday,to-read
The War of Art,Steven Pressfield,to-read
Turning Pro,Steven Pressfield,to-read
The Psychology of Money,Morgan Housel,to-read
Boyd: The Fighter Pilot Who Changed the Art of War,Robert Coram,to-read
Why Buddhism is True,Robert Wright,to-read
Why We Sleep,Matthew Walker,to-read
Alchemy: The Magic of Original Thinking in a World of Mind-Numbing Conformity,Rory Sutherland,to-read
Designing the Mind,Ryan Bush,to-read
How to Think Like a Roman Emperor,Donald Robertson,to-read
The Elephant in the Brain,Kevin Simler & Robin Hanson,to-read
Getting Things Done,David Allen,to-read
Off the Clock,Laura Vanderkam,to-read
Range: How Generalists Triumph in a Specialized World,David Epstein,to-read
Endurance: Shackleton's Incredible Voyage,Alfred Lansing,to-read
Indistractable,Nir Eyal,to-read
Lying,Sam Harris,to-read
Waking Up,Sam Harris,to-read
Experiment Without Limits,Chris Sparks,to-read
Ultralearning,Scott H. Young,to-read
Love Yourself Like Your Life Depends On It,Kamal Ravikant,to-read
Make It Stick,Peter C. Brown,to-read
The Five Ages of the Universe,Fred Adams & Greg Laughlin,to-read
Optionality,Richard Meadows,to-read
The Madness of Crowds,Douglas Murray,to-read
The Worm at the Core,Sheldon Solomon & Jeff Greenberg,to-read
Talking with Serial Killers,Christopher Berry-Dee,to-read
How to Be a Stoic,Massimo Pigliucci,to-read
Endure: Mind, Body and the Curiously Elastic Limits of Human Performance,Alex Hutchinson,to-read
Human Compatible,Stuart Russell,to-read
The Untethered Soul,Michael A. Singer,to-read
Innercise,John Assaraf,to-read
The Evolution of Desire,David Buss,to-read
The Personal MBA,Josh Kaufman,to-read
The E-Myth Revisited,Michael E. Gerber,to-read
If the Universe Is Teeming with Aliens... Where Is Everybody?,Stephen Webb,to-read
Into the Wild,Jon Krakauer,to-read
Loving What Is,Byron Katie,to-read
Thinking Fast and Slow,Daniel Kahneman,to-read
Deep Work,Cal Newport,to-read
Mindset: The New Psychology of Success,Carol Dweck,to-read
Sapiens: A Brief History of Humankind,Yuval Noah Harari,to-read
Free Speech and Why It Matters,Andrew Doyle,to-read
Happiness Beyond Thought,Gary Weber,to-read
TED Talks: The Official TED Guide to Public Speaking,Chris Anderson,to-read
The School of Life: An Emotional Education,Alain De Botton,to-read
On Confidence,The School of Life,to-read
The Lonely Century,Noreena Hertz,to-read
Billion Dollar Loser,Reeves Wiedeman,to-read
Biohacker's Handbook,Teemu Arina & Olli Sovijärvi,to-read
The Science of Sin,Jack Lewis,to-read
The Order of Time,Carlo Rovelli,to-read
The Moral Case for Fossil Fuels,Alex Epstein,to-read
Blueprint: How DNA Makes Us Who We Are,Robert Plomin,to-read
Quirkology,Richard Wiseman,to-read
Super Thinking,Gabriel Weinberg & Lauren McCann,to-read
Economy of Truth,Vizi Andrei,to-read
The Art of Resilience,Ross Edgley,to-read
Models: Attract Women Through Honesty,Mark Manson,to-read
Irresistible,Adam Alter,to-read
Lost Connections,Johann Hari,to-read
Chasing the Scream,Johann Hari,to-read
Man's Search for Meaning,Viktor Frankl,to-read
The Way of the Superior Man,David Deida,to-read
Spiritual Enlightenment: The Damnedest Thing,Jed McKenna,to-read
Rich Dad Poor Dad,Robert Kiyosaki,to-read
Blindsight,Matt Johnson & Prince Ghuman,to-read
Can't Hurt Me,David Goggins,to-read
Effortless,Greg McKeown,to-read
The Social Leap,William Von Hippel,to-read
Speechless: Controlling Words Controlling Minds,Michael Knowles,to-read
The Little Book of Life Skills,Erin Zammett Ruddy,to-read
Back Mechanic,Stuart McGill,to-read
The Power of Now,Eckhart Tolle,to-read
Red Rising,Pierce Brown,to-read
Dangerous to Know,K.T. Davies,to-read
Seveneves,Neal Stephenson,to-read
Children of Time,Adrian Tchaikovsky,to-read
Angels and Demons,Dan Brown,to-read
The Alchemist,Paulo Coelho,to-read
Kings of the Wyld,Nicholas Eames,to-read
1984,George Orwell,to-read
Animal Farm,George Orwell,to-read
Time (Manifold Book 1),Stephen Baxter,to-read
House of Leaves,Mark Z. Danielewski,to-read
The Name of the Wind,Patrick Rothfuss,to-read
`.trim().split('\n').map((line) => {
  const [title, author, shelf] = line.split(',').map((s) => s.trim());
  return { title, author, shelf: shelf || 'to-read' };
});

async function gql(query, variables, attempt = 1) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables })
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error(text.slice(0, 200)); }
  if (json.error === 'Throttled' && attempt < 5) {
    await new Promise((r) => setTimeout(r, 500 * attempt));
    return gql(query, variables, attempt + 1);
  }
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

async function getOrCreateList(name) {
  const findQ = `query($name:String!){ lists(where:{name:{_eq:$name}}, limit:1){id} }`;
  const found = await gql(findQ, { name });
  if (found.lists?.[0]) return found.lists[0].id;
  try {
    const createQ = `mutation($name:String!){ insert_list(object:{name:$name,ranked:false,featured_profile:false,privacy_setting_id:1}){ id } }`;
    const created = await gql(createQ, { name });
    return created.insert_list.id;
  } catch (e) {
    // If already exists or creation blocked, try to refetch
    const retry = await gql(findQ, { name });
    if (retry.lists?.[0]) return retry.lists[0].id;
    throw e;
  }
}

async function addToList(listId, item) {
  // Insert a barebones book via insert_book using edition dto (title only)
  const insertBook = `
    mutation InsertBook($title:String!) {
      insert_book(edition:{dto:{title:$title}}) {
        id
      }
    }
  `;
  const book = await gql(insertBook, { title: item.title });
  const bookId = book.insert_book.id;

  const upsertUserBook = `
    mutation UpsertUserBook($bookId:Int!, $statusId:Int!){
      insert_user_book(object:{book_id:$bookId, status_id:$statusId}) { id }
    }
  `;
  await gql(upsertUserBook, { bookId, statusId: 1 }); // 1 = want-to-read

  const linkList = `
    mutation LinkList($bookId:Int!, $listId:Int!){
      insert_list_book(object:{book_id:$bookId, list_id:$listId}) { id }
    }
  `;
  await gql(linkList, { bookId, listId });
}

(async () => {
  try {
    const listId = await getOrCreateList('modern wisdom 100');
    let ok = 0;
    let fail = 0;
    for (const item of rows) {
      try {
        await addToList(listId, item);
        ok++;
      } catch (e) {
        fail++;
        console.error('Failed:', item.title, e.message);
        await new Promise((r) => setTimeout(r, 500));
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    console.log('Done. Added', ok, 'books. Failed', fail);
  } catch (e) {
    console.error('Import failed', e);
    process.exit(1);
  }
})();
