import { createCn } from "cn/config"

// The type roles in index.css (text-display, text-title, …) are font-size
// utilities. Without this the merge engine treats them as text colours and
// drops them whenever a colour class is passed in the same cn() call.
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "title", "section", "body", "label", "button"] }],
    },
  },
})
