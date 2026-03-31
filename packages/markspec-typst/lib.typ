// MarkSpec Typst package — typographic themes for documents and decks.
//
// Document template:
//   #import "@driftsys/markspec:0.1.0": markspec-doc
//   #show: markspec-doc.with(title: "My Document")
//
// Slide deck (requires Touying):
//   #import "@preview/touying:0.6.1": *
//   #import "@driftsys/markspec:0.1.0": markspec-deck, markspec-title-slide, markspec-focus-slide
//   #show: markspec-deck.with(aspect-ratio: "16-9")

#import "doc.typ": markspec-doc
#import "deck.typ": markspec-deck, markspec-title-slide, markspec-focus-slide
#import "entry.typ": markspec-entry
#import "tokens.typ"
