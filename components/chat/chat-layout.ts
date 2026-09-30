// The composer's responsive width, shared by the empty-chat screen and the
// active conversation so the input does not shift when the first message lands.
// It was the same breakpoint chain written out in both places, with `lg` set to
// the same value as `md` — dropping the redundant `lg` step changes nothing.
//
// The steps are ceilings, not widths. As fixed widths they were keyed to the
// window while the composer lives in the chat column, which is the window
// minus a 350px sidebar: between roughly 640 and 1050px with the sidebar open
// the composer was wider than its column and the send button sat off-screen.
export const CHAT_COMPOSER_CONTAINER =
  "w-full min-w-[300px] items-end px-2 pb-3 pt-0 sm:max-w-[600px] sm:pb-8 sm:pt-5 md:max-w-[700px] xl:max-w-[800px]"
