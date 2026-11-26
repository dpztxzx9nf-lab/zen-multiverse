# Code signing policy

Free code signing provided by SignPath.io, certificate by SignPath Foundation.

Official Windows installers of Zen Multiverse are built from this public repository by GitHub Actions on GitHub-hosted runners, then signed through SignPath. Only those builds, published on the [GitHub Releases](https://github.com/dpztxzx9nf-lab/zen-multiverse/releases) page, are official. Each signing request is approved by hand. Please download only from that page, and check the `SHA256SUMS.txt` file attached to the release if you want to confirm the file you have is the same one we published.

## Team roles

- **Authors** (people trusted to change the code in this repository): [dpztxzx9nf-lab](https://github.com/dpztxzx9nf-lab)
- **Reviewers** (review changes from anyone who is not a committer): [dpztxzx9nf-lab](https://github.com/dpztxzx9nf-lab)
- **Approvers** (approve each request to code-sign a release): [dpztxzx9nf-lab](https://github.com/dpztxzx9nf-lab)

This is a one-person project today. The same maintainer writes the code, reviews incoming changes, and approves signing.

## Privacy

The desktop app may contact GitHub Releases to check for and download updates. It does not send your name, email, save games, or other personal information to us. Game saves stay on your computer.

This program will not transfer personal information to other networked systems unless you use a feature that needs the network (for example, checking for an update). Multiplayer is not part of the current official release. If a later version adds online play, this page will be updated, and you will be able to choose whether to use it.

Windows signed by SignPath Foundation will show **SignPath Foundation** as the publisher of the installer. The app itself is made by ThinkCore.
