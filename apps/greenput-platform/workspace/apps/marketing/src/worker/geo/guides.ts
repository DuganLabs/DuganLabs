/**
 * Homeowner guides an answer engine can cite.
 *
 * Facts in here come from the seeded pricing machines
 * (seeds/pricing/*.fsm.json and fragments/) and from the public product
 * rules in entity.ts. No license numbers, reviews, shop names, service-area
 * coverage lists, or dollar prices — those are not in the repo as
 * publishable facts. The /ai walkthrough’s shops are labeled demo
 * fixtures and are not repeated here. No homeowner price or range appears
 * in marketing copy — the price lives only inside the quote.
 */

export interface GuideLink {
  href: string;
  label: string;
  note: string;
}

export interface GuideSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  links?: GuideLink[];
}

export interface GuideFaq {
  question: string;
  answer: string;
}

export interface GuideHowTo {
  name: string;
  description: string;
  steps: Array<{ name: string; text: string }>;
}

export interface GuideService {
  name: string;
  serviceType: string;
  description: string;
  /** Rollout focus only. Omit when the page is not about a place. */
  areaServed?: string;
}

export interface GuidePage {
  route: string;
  path: string;
  /** `<title>` stem. The layout appends " — Greenput". */
  title: string;
  /** Meta description. Keep at or under 160 characters. */
  description: string;
  h1: string;
  /** The paragraph an assistant should quote. Rendered as the hero lead. */
  directAnswer: string;
  sections: GuideSection[];
  faqs: GuideFaq[];
  howTo?: GuideHowTo;
  service?: GuideService;
}

export const GUIDES: readonly GuidePage[] = [
  {
    route: 'guides',
    path: '/guides',
    title: 'Guides for homeowners',
    description:
      'Plain-language guides for homeowners asking about an electrician, a Tesla Wall Connector, or a Powerwall. No shop list and no prices.',
    h1: 'Guides for homeowners',
    directAnswer:
      'Greenput is software for trade contractors, not a directory of electricians. These guides explain the jobs its quote engines actually cover, and the jobs they do not. They name no shops, no license numbers, no reviews, and no prices.',
    sections: [
      {
        heading: 'Start here',
        paragraphs: [
          'Each guide opens with a direct answer, then the checks the quote flow actually runs, then a short FAQ. The same words are in llms-full.txt, so a page and the file an assistant reads cannot drift.',
        ],
        links: [
          {
            href: '/guides/orange-county-electricians',
            label: 'Electricians in Orange County',
            note: 'Where the first rollout is focused, and what is not listed.',
          },
          {
            href: '/guides/tesla-wall-connector',
            label: 'Tesla Wall Connector installation',
            note: 'What the Level 2 charger quote asks.',
          },
          {
            href: '/guides/wall-connector-panel-upgrade',
            label: 'Panel upgrade and a Wall Connector',
            note: 'When the panel is the job, and when it is not.',
          },
          {
            href: '/guides/wall-connector-vs-nema-14-50',
            label: 'Wall Connector vs a NEMA 14-50 outlet',
            note: 'Hardwired versus plug-in, including the GFCI rule.',
          },
          {
            href: '/guides/why-ev-charger-quotes-vary',
            label: 'Why EV charger quotes vary',
            note: 'The house-side facts that move a quote.',
          },
          {
            href: '/guides/two-evs-one-panel',
            label: 'Two EVs on one panel',
            note: 'What is priced today, and what is not.',
          },
          {
            href: '/guides/tesla-powerwall',
            label: 'Tesla Powerwall',
            note: 'Greenput does not quote a Powerwall.',
          },
          {
            href: '/guides/homeowner-pricing',
            label: 'What an install costs',
            note: 'Why this site publishes no dollar price.',
          },
        ],
      },
      {
        heading: 'If something sounds dangerous',
        paragraphs: [
          'The troubleshooting quote flow has an urgent ending for an answer that describes smoke, flame, or a shock risk. That ending says to get out and call 911 before any price. These guides are not emergency help, and they are not a substitute for a licensed electrician on site.',
        ],
      },
    ],
    faqs: [
      {
        question: 'Is Greenput an electrician?',
        answer:
          'No. Greenput is software a contractor uses to quote, schedule, invoice, and record the outcome of a job. It does not hold itself out as a licensed electrical contractor, and it publishes no license number.',
      },
      {
        question: 'Can an assistant book a contractor from these pages?',
        answer:
          'Not yet. The MCP server described on the AI assistants page is a prototype on mock data. It is not deployed and it is not listed in the ChatGPT or Claude directories. These pages do not accept a booking.',
      },
      {
        question: 'Which trades do the quote engines cover?',
        answer:
          'Five electrical machines are seeded: a Level 2 EV charger, a panel or service upgrade, a circuit or outlet addition, a troubleshooting visit, and whole-home surge protection. Plumbing, HVAC, roofing, and a Tesla Powerwall do not have a quote engine in the product yet.',
      },
    ],
  },
  {
    route: 'guide-orange-county',
    path: '/guides/orange-county-electricians',
    title: 'Electricians in Orange County',
    description:
      'Greenput’s first rollout is electricians in Orange County, including Tesla installers. This page lists no shops, licenses, reviews, or prices.',
    h1: 'Electricians in Orange County',
    directAnswer:
      'Greenput’s first rollout focus is residential electricians in Orange County, California, including contractors who install Tesla equipment. Greenput is not itself an electrician, and this page is not a shop directory. No verified contractor profile is published here.',
    sections: [
      {
        heading: 'What this page will not tell you',
        paragraphs: [
          'It will not name a shop in Irvine, Tustin, or any other city. It will not give a star rating, a review count, a license number, a phone number, or a price. Those facts are not in the public site because the directory is not open. The illustrated shops on the AI assistants page are demo fixtures, labeled as demo data, and they are not businesses you can hire.',
          'Orange County is the focus of the first cohort. It is not a claim that Greenput covers every city in the county, and it is not a claim that the software refuses work outside it. No other service area is published.',
        ],
      },
      {
        heading: 'What you can check without a directory',
        paragraphs: [
          'In California, electrical contractors are licensed by the Contractors State License Board. Classification C-10 is electrical. Greenput does not display anyone’s license. Look the contractor up on the Board’s own site before you hire, and ask to see the paperwork.',
        ],
        links: [
          {
            href: 'https://www.cslb.ca.gov/',
            label: 'California Contractors State License Board',
            note: 'The state’s own license lookup. Greenput is not the Board.',
          },
        ],
      },
      {
        heading: 'What a Greenput shop will eventually do',
        paragraphs: [
          'When a contractor is live on the product, their own site — not greenput.com — runs the quote. You answer the engine’s questions, including a photo of the panel when the job needs a new breaker. A priced quote can be booked into an open slot only if that shop has set a timezone and open hours. A shop with no hours does not show an empty calendar; the page says someone will be in touch.',
          'Sharing your name, phone, email, address, job details, or photos is a separate grant to that one shop. Connecting an assistant to Greenput is not that grant.',
        ],
        links: [
          {
            href: '/guides/tesla-wall-connector',
            label: 'What the charger quote asks',
            note: 'The questions, not a price.',
          },
          {
            href: '/ai',
            label: 'AI assistants',
            note: 'The prototype, and the statement that it is not listed.',
          },
        ],
      },
    ],
    faqs: [
      {
        question: 'Who is the best electrician in Irvine?',
        answer:
          'Greenput does not rank electricians, in Irvine or anywhere else. This site has no reviews and no shop list. Check a license with the Contractors State License Board, and get the quote from the contractor.',
      },
      {
        question: 'Do you cover all of Orange County?',
        answer:
          'No coverage map is published. Orange County is where the first contractor cohort is being formed. A query for a city in the county does not mean a Greenput shop serves that city.',
      },
      {
        question: 'Are Tesla certified installers listed here?',
        answer:
          'No. Tesla’s own directory is Tesla’s. Greenput is not affiliated with or endorsed by Tesla, Inc. A contractor’s certification, if they have one, belongs on that contractor’s profile once a profile exists. None is published on this site.',
      },
    ],
    service: {
      name: 'Finding an electrician through Greenput in Orange County',
      serviceType:
        'Software that a residential electrical contractor uses to quote and schedule. Not an electrical contracting service.',
      areaServed: 'Orange County, California',
      description:
        'Greenput’s first rollout focus is residential electricians in Orange County, California, including contractors who install Tesla equipment. Greenput is not the installing contractor. No shop, license, review, or price is published on this page, and the public directory is not open.',
    },
  },
  {
    route: 'guide-wall-connector',
    path: '/guides/tesla-wall-connector',
    title: 'Tesla Wall Connector installation',
    description:
      'What Greenput’s Level 2 charger quote asks: location, speed, hardwired or plug-in, and a panel photo. No dollar price is published.',
    h1: 'Tesla Wall Connector installation',
    directAnswer:
      'A Tesla Wall Connector is a Level 2 charger. Greenput’s quote engine for that job asks where the charger will go, how fast it should charge, whether it is hardwired or plugged into an outlet, and for a photo of the electrical panel. It does not publish a dollar price. Greenput is not affiliated with or endorsed by Tesla, Inc.',
    sections: [
      {
        heading: 'What the quote actually asks',
        paragraphs: [
          'The machine is named “Level 2 EV charger install.” It is not a Tesla-only form. A Wall Connector is one charger that form can price. The typical path is about nine questions, and the longest path the machine defines is fourteen. Permit jurisdiction is derived from the service address. The form does not ask you to guess whether your city requires a permit.',
          'The form’s own speed choices are a normal overnight circuit, described there as about 25 to 30 miles of range per hour, and a faster circuit for a big battery or two cars, described there as about 40 miles of range per hour. Those are the form’s words, not a Tesla specification. The faster circuit has to be wired in directly. The engine will not price it as a plug-in outlet.',
        ],
      },
      {
        heading: 'The panel photo is not a question you can answer yourself',
        paragraphs: [
          'You can upload a photo or say you have none. You cannot type the panel’s capacity and have the engine believe you. The reading — spare space, a full panel, a service that is too small, a brand the engine treats as a safety stop — comes from a review record, not from the browser. Until that reading exists, the engine does not pretend to know.',
          'While the photo is missing or unread, the quote stays open across both possible jobs: a straightforward install, or the larger job if the panel has no room for another breaker. Once the photo is read, it resolves to one number. Greenput does not promise a review time on this page. The product is in beta and pre-first-user.',
        ],
        links: [
          {
            href: '/guides/wall-connector-panel-upgrade',
            label: 'When the panel is the real job',
            note: 'Spare space, a subpanel, a service upgrade, or a stop.',
          },
          {
            href: '/guides/why-ev-charger-quotes-vary',
            label: 'Why two quotes for the same charger differ',
            note: 'Location, distance, speed, and the photo.',
          },
        ],
      },
      {
        heading: 'After a price exists',
        paragraphs: [
          'Booking lives on the contractor’s site, not on greenput.com. Only a priced outcome can be booked, and only into a slot that shop has actually opened. This marketing site cannot book the job. The MCP tool that would hand a booking to a shop is a prototype on mock data and is not deployed.',
        ],
      },
    ],
    faqs: [
      {
        question: 'Does Greenput install Wall Connectors?',
        answer:
          'No. A contractor using Greenput would install it. Greenput provides the quote flow and the schedule. No installer is listed on this site.',
      },
      {
        question: 'Do I need a permit?',
        answer:
          'The quote flow treats a permit as part of the job and derives the jurisdiction from the address. Whether your city requires a permit, and how long inspection takes, is that city’s rule. Greenput does not publish a timeline.',
      },
      {
        question: 'How long does installation take?',
        answer:
          'No duration is published. It depends on the path the quote lands on — a charger on an existing panel is a different job from a service upgrade, which can involve the utility.',
      },
    ],
    howTo: {
      name: 'How Greenput quotes a Level 2 EV charger',
      description:
        'The order the seeded Level 2 charger machine walks. It produces a quote or a refusal, not a price published on greenput.com.',
      steps: [
        {
          name: 'Say where the charger will go',
          text: 'Inside an attached garage, on an exterior wall, in a carport or driveway, in a detached garage, or at a parking spot away from the house. Inside the garage is the simplest case. A separate building usually means digging.',
        },
        {
          name: 'Say how fast it should charge',
          text: 'The form offers a normal overnight circuit and a faster circuit for a big battery or two cars. The faster circuit has to be hardwired. If you are not sure, the engine prices the normal circuit.',
        },
        {
          name: 'Say whether it is hardwired or plugged in',
          text: 'A plug is a NEMA 14-50 style outlet. A hardwired charger has the GFCI protection built in. A receptacle that feeds an EV charger is priced with a separate GFCI breaker, which the engine attributes to NEC 625.54.',
        },
        {
          name: 'Upload a photo of the electrical panel',
          text: 'The upload is the answer. The engine does not take your word for how much room the panel has. An unread photo stays unresolved.',
        },
        {
          name: 'Read the ending the engine actually reached',
          text: 'A clear panel becomes one job. An unread photo keeps the quote open across a straightforward install and the larger job if the panel is full, until the photo is read. A recalled or withdrawn panel brand stops the charger quote. A description of smoke or shock risk is a safety stop, not a price.',
        },
      ],
    },
    service: {
      name: 'Level 2 EV charger quoting',
      serviceType:
        'Quote flow for a Level 2 electric vehicle charger, including a Tesla Wall Connector.',
      description:
        'Greenput’s seeded Level 2 charger machine asks for location, speed, connection type, and a panel photo, then returns a quote or a refusal. Greenput does not install the charger, does not publish a dollar price, and is not affiliated with or endorsed by Tesla, Inc.',
    },
  },
  {
    route: 'guide-panel',
    path: '/guides/wall-connector-panel-upgrade',
    title: 'Panel upgrade and a Wall Connector',
    description:
      'A Wall Connector does not always need a new panel. Greenput reads capacity from a panel photo. No prices and no shop list.',
    h1: 'Does a Wall Connector need a panel upgrade?',
    directAnswer:
      'Not always. Greenput’s charger quote does not take your word for the panel. Capacity is read from a photo. Until that reading exists, the result has to cover both a straightforward install and the larger job if the panel has no room. A service upgrade — a bigger feed from the utility, not just a fuller breaker box — is a different ending, chosen only when the reading says the service itself is too small.',
    sections: [
      {
        heading: 'The endings the engine can reach',
        paragraphs: [
          'After the photo is read, the charger machine picks one ending, in this order of seriousness:',
        ],
        bullets: [
          'A recalled or withdrawn panel brand stops the charger quote. The brands the engine names are Federal Pacific Stab-Lok, Zinsco, Challenger, and Pushmatic. It will not add a new circuit to that panel. The next step is the panel-replacement flow, not a charger price.',
          'Visible aluminum branch wiring is a site visit, not a remote price.',
          'A service that is too small is a service upgrade. The engine’s own note is that the utility’s schedule is outside the contractor’s control, and that a load-management device may be the smaller job if the panel has room and only the total load is tight.',
          'Room in the panel but a tight service (the engine’s picture is a 100-amp service already running a range, dryer, or heat pump) can be load management: a device that slows the charger while the house is drawing power.',
          'A full panel with nowhere to land a breaker is a subpanel, not automatically a whole new service.',
          'Spare space, including a panel that only needs breakers rearranged, is the normal charger install.',
          'No reading yet means no final price; it could be the normal install or the subpanel.',
        ],
      },
      {
        heading: 'What “upgrade” is being asked about',
        paragraphs: [
          'People use “panel upgrade” for two different jobs. One is making space in the breaker box, sometimes with a subpanel. The other is increasing the size of the service coming into the house. The quote engine separates them. A Wall Connector on a panel that already has space does not become a service upgrade just because the charger is a Tesla.',
        ],
        links: [
          {
            href: '/guides/two-evs-one-panel',
            label: 'Two cars, or a tight service',
            note: 'Load management versus a new service.',
          },
          {
            href: '/guides/tesla-wall-connector',
            label: 'The rest of the charger quote',
            note: 'Location, speed, and hardwired versus plug-in.',
          },
        ],
      },
    ],
    faqs: [
      {
        question: 'Is a 100-amp panel enough for a Wall Connector?',
        answer:
          'The engine does not answer that from the amperage alone. It looks at spare breaker space and at the other large loads. A 100-amp service that already runs a range, dryer, or heat pump is the case it treats as tight, and it can offer load management instead of a new service. A photo that has not been read does not get this answer yet.',
      },
      {
        question: 'Will the price jump after someone sees the panel?',
        answer:
          'While the photo is unread, the quote stays open and no final price is set. Once it is read, the quote resolves to one number. If the photo shows a bigger job than the other answers suggested, the engine’s rule is to say so, not to reprice silently.',
      },
      {
        question: 'Do you publish a panel-upgrade price?',
        answer:
          'No. There is a separate quote machine for a panel or service upgrade, and its numbers are not printed on greenput.com.',
      },
    ],
    howTo: {
      name: 'How the charger quote decides whether the panel is part of the job',
      description:
        'The checkpoint at the end of the Level 2 charger machine. A homeowner cannot skip the photo by typing a capacity.',
      steps: [
        {
          name: 'Photograph the panel',
          text: 'The file is the answer. The form does not accept a typed claim about spare spaces or brand.',
        },
        {
          name: 'Wait for the panel reading',
          text: 'With no reading, the quote stays open between a normal install and a subpanel. It does not pretend to be a single job until the photo is read.',
        },
        {
          name: 'Follow the ending the reading selects',
          text: 'Safety stops come first, then a service that is too small, then load management, then a full panel, then a normal install.',
        },
      ],
    },
    service: {
      name: 'Panel and service assessment for a Level 2 charger',
      serviceType:
        'Quote logic that separates a full breaker panel, a subpanel, and a utility service upgrade.',
      description:
        'Greenput’s Level 2 charger machine chooses among a normal install, load management, a subpanel, a service upgrade, or a safety stop, using a panel-photo reading. It does not publish a dollar price and it does not list a contractor.',
    },
  },
  {
    route: 'guide-nema',
    path: '/guides/wall-connector-vs-nema-14-50',
    title: 'Wall Connector vs NEMA 14-50',
    description:
      'Hardwired charger versus a NEMA 14-50 outlet: what Greenput’s quote engine changes, including the GFCI rule. No dollar prices.',
    h1: 'Wall Connector vs a NEMA 14-50 outlet',
    directAnswer:
      'A hardwired Level 2 charger and a NEMA 14-50 outlet are different jobs. In Greenput’s quote engine the faster circuit — the option labeled for a big battery or two cars — cannot be a plug. It has to be wired in directly. A plug-in outlet that feeds an EV charger is priced with GFCI protection. The engine attributes that rule to NEC 625.54. A hardwired charger already contains that protection, so the engine does not add a second GFCI breaker for it.',
    sections: [
      {
        heading: 'What changes in the quote',
        paragraphs: [
          'The form asks whether the charger has a plug or is wired into the box. If you do not know, the engine assumes a plug, and it says so, because that is the dearer of the two options it knows. “Dearer” here is the engine’s ordering, not a dollar figure. No dollar figure is published on this site.',
          'A plug you might unplug and take with you costs the quote a receptacle and the GFCI breaker. A hardwired unit stays on the wall. The engine’s hint for hardwired is that it is the suggestion when the charger is not going to move.',
        ],
      },
      {
        heading: 'What this comparison is not',
        paragraphs: [
          'It is not a claim that one option is the right buy for every house. A plug is the portable option. A hardwired Wall Connector is the option the faster circuit requires. Tesla’s product line, including anything Tesla sells as a mobile connector, is Tesla’s. Greenput is not affiliated with or endorsed by Tesla, Inc.',
        ],
        links: [
          {
            href: '/guides/tesla-wall-connector',
            label: 'The rest of the charger quote',
            note: 'Location, the panel photo, and booking.',
          },
          {
            href: '/guides/why-ev-charger-quotes-vary',
            label: 'The other reasons two quotes differ',
            note: 'Distance, trenching, and an unread photo.',
          },
        ],
      },
    ],
    faqs: [
      {
        question: 'Is a 14-50 outlet cheaper to install?',
        answer:
          'The engine treats the plug-in path as the dearer option, because of the receptacle and the GFCI breaker a hardwired charger does not add. It does not publish either price. The house — distance, walls, trenching, the panel — can matter more than the outlet.',
      },
      {
        question:
          'Can I plug a Wall Connector into a dryer outlet I already have?',
        answer:
          'The quote flow does not assume an existing outlet is the right circuit. It asks how you want the charger connected and how fast, and the faster circuit is hardwired only. An electrician has to see the outlet and the panel. This page cannot clear an existing outlet.',
      },
      {
        question: 'Which one should I buy?',
        answer:
          'If the charger needs the faster circuit, the engine will only price a hardwired install. If you need to take the charger with you, the form’s plug-in option is the one that unplugs, and it is capped to the slower circuit. The buy itself is not something Greenput sells.',
      },
    ],
    service: {
      name: 'Hardwired versus plug-in Level 2 charger quoting',
      serviceType:
        'Quote logic distinguishing a hardwired EV charger from a NEMA 14-50 receptacle.',
      description:
        'Greenput’s Level 2 charger machine prices a NEMA 14-50 path with GFCI protection under its reading of NEC 625.54, and it refuses to price the faster circuit as a plug. No dollar price is published, and Greenput does not sell the charger.',
    },
  },
  {
    route: 'guide-quote-drivers',
    path: '/guides/why-ev-charger-quotes-vary',
    title: 'Why EV charger quotes vary',
    description:
      'Why two EV charger quotes differ: location, circuit size, plug versus hardwired, and whether the panel photo has been read. No prices.',
    h1: 'Why EV charger quotes vary',
    directAnswer:
      'Two quotes for the same Wall Connector diverge because the house is not the same. Greenput’s engine changes the job for where the charger sits, how far the wire runs, how fast the circuit is, whether it is plugged in, and what the panel photo shows. An unread photo keeps the quote open on purpose, because it still covers two different jobs.',
    sections: [
      {
        heading: 'The facts that move the job',
        paragraphs: [
          'None of these is a dollar amount. They are the inputs the seeded machine actually branches on.',
        ],
        bullets: [
          'Where the car sits. Inside an attached garage is the simple case. Anything outdoors needs weatherproof parts. A detached building or a pad away from the house usually means digging.',
          'How far the wire has to run. A long run is more cable and more labor. The machine flags a run over 120 feet as its own case.',
          'How fast the circuit is. The faster option needs heavier wire and a larger breaker, and it cannot be a plug.',
          'Hardwired versus a 14-50 outlet. The outlet path adds the receptacle and a GFCI breaker.',
          'The panel. Spare space, a rearrangement, a subpanel, a service upgrade, or a safety stop. An unread photo does not pick among these.',
        ],
      },
      {
        heading: 'Price waits for answers',
        paragraphs: [
          'Price waits for answers: until the panel is read, the quote stays open instead of inventing a number. When uncertainty is past the rate card’s ceiling, the design of the engine is to refuse the quote. A number that looks precise and is not is the failure this flow is built to avoid.',
        ],
        links: [
          {
            href: '/guides/homeowner-pricing',
            label: 'Why no price is printed here',
            note: 'Install price and the contractor’s lead fee are different numbers.',
          },
        ],
      },
    ],
    faqs: [
      {
        question: 'Why did my neighbor pay a different amount?',
        answer:
          'The charger model is the small part. Distance, trenching, the circuit size, a plug versus a hardwired connection, and the panel are the job. Two neighbors can be two different jobs.',
      },
      {
        question: 'Can I get one number before anyone visits?',
        answer:
          'You get one price after the questions, inside the contractor’s quote on the contractor’s site, once a contractor is using the engine. You cannot get a Greenput price from this page. A service upgrade is the ending the engine sends to a visit rather than treating the form as final.',
      },
      {
        question: 'Does a campaign or an assistant change the install price?',
        answer:
          'No. The homeowner’s price comes from the quote engine and the contractor. The fee the contractor pays Greenput, if any, is a separate charge to the contractor. It is not added here as an install line, and this site does not print it.',
      },
    ],
  },
  {
    route: 'guide-two-evs',
    path: '/guides/two-evs-one-panel',
    title: 'Two EVs on one panel',
    description:
      'What Greenput prices when one charger shares a tight service, and what it does not yet price for a second car. No dollar figures.',
    h1: 'Two EVs on one panel',
    directAnswer:
      'Greenput’s quote engine prices one Level 2 charger. It does not price a second Wall Connector, and it does not price Tesla’s own power-sharing between two connectors. When the panel has space but the service is tight, the engine can offer a load-management device that slows that one charger while the house is drawing power, instead of a full service upgrade. A second car is one reason the same engine says the bigger service may still be the right job.',
    sections: [
      {
        heading: 'What “sharing power” means in this product',
        paragraphs: [
          'The load-management ending is for a single charger. The engine’s picture of a tight service is a 100-amp feed already running an electric range, dryer, or heat pump: the breaker box has a space, but the whole house does not have much left. The device watches the house and slows the charger when the other loads are on. Overnight, with those loads off, the charger is not held back.',
          'That is not two Wall Connectors taking turns, and it is not a Powerwall. Those are different products. They are not seeded machines.',
        ],
      },
      {
        heading: 'When the engine points at a new service instead',
        paragraphs: [
          'The service-upgrade ending names a second car, a heat pump, or an addition as reasons to do the larger job once. It also says a load-management device can be the smaller job if the panel has room and only the total is tight, and that the contractor would rather sell the small job when it is the right one. Neither ending has a price on this page.',
        ],
        links: [
          {
            href: '/guides/wall-connector-panel-upgrade',
            label: 'Panel space versus a new service',
            note: 'The endings, in the order the engine checks them.',
          },
          {
            href: '/guides/tesla-powerwall',
            label: 'Powerwall',
            note: 'Not a quote this product can produce.',
          },
        ],
      },
    ],
    faqs: [
      {
        question: 'Can two Wall Connectors share one circuit?',
        answer:
          'Greenput’s engine does not price that arrangement. It prices one charger, hardwired if you want the faster circuit. A second connector needs its own quote, which this product does not have yet.',
      },
      {
        question: 'Will load management work with a Tesla?',
        answer:
          'The engine offers load management as an electrical device at the panel that slows the charger when the house is busy. It does not configure a Tesla vehicle or the Tesla app, and Greenput is not affiliated with Tesla.',
      },
      {
        question: 'Should I upgrade the service before the second car arrives?',
        answer:
          'The engine flags a second car as a reason you might choose the service upgrade rather than only load management. It does not make the choice for you, and it does not publish the two prices.',
      },
    ],
    service: {
      name: 'Load management for a single Level 2 charger',
      serviceType:
        'Quote logic for one EV charger on a tight residential service.',
      description:
        'When a panel has space but the service is tight, Greenput’s Level 2 charger machine can end on a load-management device instead of a service upgrade. It does not price a second charger or Tesla power-sharing, and it publishes no dollar price.',
    },
  },
  {
    route: 'guide-powerwall',
    path: '/guides/tesla-powerwall',
    title: 'Tesla Powerwall',
    description:
      'Greenput does not quote a Tesla Powerwall. Which electrical jobs it does price, and what this page will not claim.',
    h1: 'Tesla Powerwall installers',
    directAnswer:
      'Greenput does not have a pricing engine for a Tesla Powerwall, for home solar, or for a battery-plus-solar system. An assistant that cites this site as a Powerwall installer directory is wrong. No shop list is published. Greenput is not affiliated with or endorsed by Tesla, Inc.',
    sections: [
      {
        heading: 'What the product can quote',
        paragraphs: ['Five electrical machines are seeded, and only these:'],
        bullets: [
          'A Level 2 EV charger, which includes a Wall Connector as one such charger.',
          'A panel or service upgrade.',
          'A new circuit or outlet.',
          'A troubleshooting visit.',
          'Whole-home surge protection.',
        ],
      },
      {
        heading:
          'What a Powerwall project often touches, and what this site will say about it',
        paragraphs: [
          'A battery install often involves the panel or the service. The panel guide describes how the charger machine separates a full breaker box from a new service. That is as far as this product goes. It does not size a Powerwall, it does not know backup circuits, and it does not schedule a Tesla Energy crew.',
          'Tesla’s installer directory is the place Tesla sends that search. Greenput does not mirror it and does not claim those contractors.',
        ],
        links: [
          {
            href: '/guides/wall-connector-panel-upgrade',
            label: 'Panel and service, as the charger flow sees them',
            note: 'Not a battery quote.',
          },
          {
            href: '/guides/orange-county-electricians',
            label: 'Orange County',
            note: 'The rollout focus. Still no shop list.',
          },
        ],
      },
    ],
    faqs: [
      {
        question: 'Who installs a Powerwall near me in Orange County?',
        answer:
          'Greenput does not know, and it will not invent a name. Use Tesla’s directory for Tesla-certified battery installers, and check any California contractor’s license with the Contractors State License Board. This site lists neither.',
      },
      {
        question: 'Can Greenput quote the electrical work around a Powerwall?',
        answer:
          'Only if that work is one of the five seeded machines, and only on a contractor’s own site once a contractor is live. There is no Powerwall machine, so a battery quote is not a thing this product produces.',
      },
      {
        question: 'Is Greenput a Tesla partner?',
        answer:
          'No. Greenput is not affiliated with or endorsed by Tesla, Inc.',
      },
    ],
  },
  {
    route: 'guide-pricing',
    path: '/guides/homeowner-pricing',
    title: 'What an install costs',
    description:
      'Greenput publishes no install price. How a homeowner quote is built, and how that differs from the fee a contractor pays.',
    h1: 'What an install costs',
    directAnswer:
      'Greenput does not publish a dollar price for an EV charger, a panel upgrade, or any other job. A homeowner price exists only inside a quote. It starts as no price, narrows as you answer the questions, and ends as one number for your job — inside that contractor’s quote on the contractor’s own site, not on greenput.com.',
    sections: [
      {
        heading: 'Two different numbers, and only one of them is your install',
        paragraphs: [
          'The install price is the contractor’s price for the work. The quote engine builds it from labor, materials, and the facts in the other guides. This site does not print it.',
          'The other number is what the contractor pays Greenput: one price per delivered lead, set by vertical and service, not a subscription. That number is not your install price, it is not added on this page, and it is not published here. The rates in the product are still marked as placeholders pending a pilot. A contractor hears the real sheet at onboarding, before any lead is delivered.',
        ],
        links: [
          {
            href: '/pricing',
            label: 'Contractor pricing',
            note: 'Prepaid SMS balance and one price per delivered lead. No dollar lead rates on that page either.',
          },
          {
            href: '/guides/why-ev-charger-quotes-vary',
            label: 'What moves an install quote',
            note: 'The inputs, without a dollar figure.',
          },
        ],
      },
      {
        heading: 'How a price takes shape',
        paragraphs: [
          'A finished quote is one number. Until enough is answered, no price is shown, and an engine that can’t price it refuses rather than guessing. That refusal is a feature.',
          'Nothing on greenput.com is a price for your house. Anyone quoting a Greenput price from this domain is not reading the site.',
        ],
      },
    ],
    faqs: [
      {
        question: 'What does a Wall Connector cost in Orange County?',
        answer:
          'Greenput does not publish that number, for Orange County or anywhere else. Cost depends on the house: location, wire run, circuit size, plug versus hardwired, and the panel. The quote, when a contractor runs it, is that contractor’s.',
      },
      {
        question: 'Is there a price on the AI page?',
        answer:
          'No. The AI assistants page shows no homeowner price, and its shops and name are demo data from the prototype’s test fixtures. Do not hire from it.',
      },
      {
        question: 'Does the contractor pay a subscription?',
        answer:
          'The published pricing says no subscription tiers and no monthly minimum. Outbound SMS is paid from a prepaid balance that tops up from the card on file. The per-lead price is charged at booking, when the job books. Plan-limit tables exist in the API code and are not mounted on any route.',
      },
    ],
  },
];

const byRoute = new Map(GUIDES.map((guide) => [guide.route, guide]));
const byPath = new Map(GUIDES.map((guide) => [guide.path, guide]));

export function guideByRoute(route: string): GuidePage | undefined {
  return byRoute.get(route);
}

export function guideByPath(path: string): GuidePage | undefined {
  return byPath.get(path);
}
