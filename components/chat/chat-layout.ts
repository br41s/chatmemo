// The composer's responsive width, shared by the empty-chat screen and the
// active conversation so the input does not shift when the first message lands.
// It was the same breakpoint chain written out in both places, with `lg` set to
// the same value as `md` — dropping the redundant `lg` step changes nothing.
export const CHAT_COMPOSER_CONTAINER =
  "w-full min-w-[300px] items-end px-2 pb-3 pt-0 sm:w-[600px] sm:pb-8 sm:pt-5 md:w-[700px] xl:w-[800px]"
