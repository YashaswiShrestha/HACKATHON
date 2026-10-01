import demoDeskDoorway from '../assets/images/demo_desk_doorway_1790829480024.jpg';
import demoSignMenu from '../assets/images/demo_sign_menu_1790829497307.jpg';
import demoRoomBackpack from '../assets/images/demo_room_backpack_1790829509334.jpg';
import demoCounterLabel from '../assets/images/demo_counter_label_1790829521020.jpg';

export interface DemoScene {
  id: string;
  title: string;
  shortLabel: string;
  imageUrl: string;
  altText: string;
  suggestedQuestions: string[];
  suggestedFinds: string[];
}

export const DEMO_SCENES: DemoScene[] = [
  {
    id: 'desk-doorway',
    title: 'Scene 1: Work Desk & Doorway',
    shortLabel: '1. Desk & Doorway',
    imageUrl: demoDeskDoorway,
    altText: 'First-person camera view of a wooden table directly ahead with an open silver laptop, a stainless steel water bottle slightly left of center, a black notebook, and an open doorway on the right.',
    suggestedQuestions: [
      'What is on the table?',
      'Where is the door?',
      'Is the laptop open or closed?',
    ],
    suggestedFinds: [
      'Find my water bottle',
      'Find the door',
      'Find the laptop',
    ],
  },
  {
    id: 'sign-menu',
    title: 'Scene 2: Hallway Sign & Café Menu',
    shortLabel: '2. Sign & Café Menu',
    imageUrl: demoSignMenu,
    altText: 'First-person camera view of an indoor wall directional sign for Room 204 Conference Hall and Exit Door to the right, alongside a coffee bar menu board with prices.',
    suggestedQuestions: [
      'What does this sign say?',
      'How much is an oat latte?',
      'Which way is the exit door?',
    ],
    suggestedFinds: [
      'Find the exit sign',
      'Find the coffee menu',
      'Find Room 204',
    ],
  },
  {
    id: 'room-backpack',
    title: 'Scene 3: Living Room & Red Backpack',
    shortLabel: '3. Room & Backpack',
    imageUrl: demoRoomBackpack,
    altText: 'First-person camera view of a bright room with a red canvas backpack resting on a chair slightly left of center, a wooden coffee table in the middle, and a closed white door on the right.',
    suggestedQuestions: [
      'Is there a chair nearby?',
      'What color is the backpack?',
      'Where is the door?',
    ],
    suggestedFinds: [
      'Find the red backpack',
      'Find the chair',
      'Find the door',
    ],
  },
  {
    id: 'counter-label',
    title: 'Scene 4: Kitchen Counter & Vitamin Bottle',
    shortLabel: '4. Counter & Label',
    imageUrl: demoCounterLabel,
    altText: 'First-person camera view of a kitchen counter with a vitamin bottle labeled Daily Multivitamin Take One Tablet With Water, black-framed reading glasses in the center, and a ceramic mug on the right.',
    suggestedQuestions: [
      'What are the instructions on the bottle?',
      'Where are my glasses?',
      'What objects are on the counter?',
    ],
    suggestedFinds: [
      'Find my glasses',
      'Find the vitamin bottle',
      'Find the mug',
    ],
  },
];
